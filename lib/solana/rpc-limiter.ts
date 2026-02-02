class RpcRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;

  constructor(maxTokens = 80, refillPerSecond = 80) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRatePerMs = refillPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRatePerMs
    );
    this.lastRefill = now;
  }

  async acquire(count = 1): Promise<void> {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }
    const waitMs = Math.ceil((count - this.tokens) / this.refillRatePerMs);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    this.tokens = Math.max(0, this.tokens - count);
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

const globalForRpcLimiter = globalThis as unknown as {
  rpcLimiter?: RpcRateLimiter;
};

export const rpcLimiter =
  globalForRpcLimiter.rpcLimiter ?? new RpcRateLimiter(80, 80);

if (process.env.NODE_ENV !== "production") {
  globalForRpcLimiter.rpcLimiter = rpcLimiter;
}
