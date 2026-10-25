interface Bucket {
  count: number;
  resetAt: number;
}

/** Small in-process fixed-window limiter for socket events. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly cleanup: NodeJS.Timeout;

  constructor() {
    this.cleanup = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(key);
      }
    }, 60_000);
    this.cleanup.unref?.();
  }

  consume(key: string, max: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
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

  dispose(): void {
    clearInterval(this.cleanup);
    this.buckets.clear();
  }
}
