class RateLimiter {
  buckets = /* @__PURE__ */ new Map();
  cleanup;
  constructor() {
    this.cleanup = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(key);
      }
    }, 6e4);
    this.cleanup.unref?.();
  }
  consume(key, max, windowMs) {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (bucket.count >= max) {
      return { allowed: false, retryAfterMs: Math.max(1, bucket.resetAt - now) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
  dispose() {
    clearInterval(this.cleanup);
    this.buckets.clear();
  }
}
export {
  RateLimiter
};
