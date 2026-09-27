/**
 * Multi-Tier In-Memory Rate Limiter and Brute-Force Protection
 * Prevents socket abuse, room enumeration, and message flooding without database dependencies.
 */
export class SlidingWindowLimiter {
    records = new Map();
    maxRequests;
    windowMs;
    constructor(maxRequests, windowMs) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        // Periodic sweep every 60s
        setInterval(() => this.cleanup(), 60000).unref();
    }
    isRateLimited(key) {
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
    reset(key) {
        this.records.delete(key);
    }
    cleanup() {
        const now = Date.now();
        for (const [key, record] of this.records.entries()) {
            const recent = record.timestamps.filter((ts) => now - ts < this.windowMs);
            if (recent.length === 0) {
                this.records.delete(key);
            }
            else {
                this.records.set(key, { timestamps: recent });
            }
        }
    }
}
export class BruteForceProtection {
    records = new Map();
    maxFailures;
    lockoutDurationMs;
    constructor(maxFailures = 5, lockoutDurationMs = 60000) {
        this.maxFailures = maxFailures;
        this.lockoutDurationMs = lockoutDurationMs;
        setInterval(() => this.cleanup(), 60000).unref();
    }
    isLockedOut(key) {
        const now = Date.now();
        const record = this.records.get(key);
        if (!record)
            return { locked: false };
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
    recordFailure(key) {
        const now = Date.now();
        const record = this.records.get(key) || { failedAttempts: 0, lockoutUntil: 0 };
        record.failedAttempts += 1;
        if (record.failedAttempts >= this.maxFailures) {
            record.lockoutUntil = now + this.lockoutDurationMs;
        }
        this.records.set(key, record);
    }
    recordSuccess(key) {
        this.records.delete(key);
    }
    cleanup() {
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
// 500 signaling packets per 5 seconds (prevents dropping burst trickle ICE candidates during call establishment)
export const signalingFloodLimiter = new SlidingWindowLimiter(500, 5000);
// 5 failed room code attempts triggers a 60s lockout
export const joinBruteForceProtection = new BruteForceProtection(5, 60000);
