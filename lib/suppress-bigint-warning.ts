const globalForBigintWarning = globalThis as unknown as {
  bigintWarningSuppressed?: boolean;
};

if (!globalForBigintWarning.bigintWarningSuppressed) {
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const message = typeof args[0] === "string" ? args[0] : "";
    if (message.includes("bigint: Failed to load bindings, pure JS will be used")) {
      return;
    }
    originalWarn(...args);
  };
  globalForBigintWarning.bigintWarningSuppressed = true;
}
