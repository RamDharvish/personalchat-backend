/**
 * Multi-Tier In-Memory Rate Limiter and Brute-Force Protection
 * Prevents socket abuse, room enumeration, and message flooding without database dependencies.
 */

interface SlidingWindowRecord {
  timestamps: number[];
}

interface LockoutRecord {
  failedAttempts: number;
  lockoutUntil: number;
}

export class SlidingWindowLimiter {
  private records = new Map<string, SlidingWindowRecord>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Periodic sweep every 60s
    setInterval(() => this.cleanup(), 60000).unref();
  }

  public isRateLimited(key: string): boolean {
    const now = Date.now();
    const record = this.records.get(key) || { timestamps: [] };

    // Filter to timestamps within sliding window
    const recent = record.timestamps.filter((ts) => now - ts < this.windowMs);

    if (recent.length >= this.maxRequests) {
      this.records.set(key, { timestamps: recent });
      return true;
    }

    recent.push(now);
    this.records.set(key, { timestamps: recent });
    return false;
  }

  public reset(key: string): void {
    this.records.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      const recent = record.timestamps.filter((ts) => now - ts < this.windowMs);
      if (recent.length === 0) {
        this.records.delete(key);
      } else {
        this.records.set(key, { timestamps: recent });
      }
    }
  }
}

export class BruteForceProtection {
  private records = new Map<string, LockoutRecord>();
  private readonly maxFailures: number;
  private readonly lockoutDurationMs: number;

  constructor(maxFailures = 5, lockoutDurationMs = 60000) {
    this.maxFailures = maxFailures;
    this.lockoutDurationMs = lockoutDurationMs;

    setInterval(() => this.cleanup(), 60000).unref();
  }

  public isLockedOut(key: string): { locked: boolean; remainingSeconds?: number } {
    const now = Date.now();
    const record = this.records.get(key);

    if (!record) return { locked: false };

    if (record.lockoutUntil > now) {
      const remainingSeconds = Math.ceil((record.lockoutUntil - now) / 1000);
      return { locked: true, remainingSeconds };
    }

    // Lockout expired
    if (record.lockoutUntil > 0 && record.lockoutUntil <= now) {
      this.records.delete(key);
    }

    return { locked: false };
  }

  public recordFailure(key: string): void {
    const now = Date.now();
    const record = this.records.get(key) || { failedAttempts: 0, lockoutUntil: 0 };

    record.failedAttempts += 1;
    if (record.failedAttempts >= this.maxFailures) {
      record.lockoutUntil = now + this.lockoutDurationMs;
    }

    this.records.set(key, record);
  }

  public recordSuccess(key: string): void {
    this.records.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      if (record.lockoutUntil > 0 && record.lockoutUntil < now) {
        this.records.delete(key);
      }
    }
  }
}

// 5 messages per 2 seconds
export const messageFloodLimiter = new SlidingWindowLimiter(5, 2000);

// 40 signaling packets per 5 seconds
export const signalingFloodLimiter = new SlidingWindowLimiter(40, 5000);

// 5 failed room code attempts triggers a 60s lockout
export const joinBruteForceProtection = new BruteForceProtection(5, 60000);
