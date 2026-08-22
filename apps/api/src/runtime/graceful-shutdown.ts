export type RuntimeSignal = "SIGINT" | "SIGTERM";

export function createGracefulShutdown(
  close: () => Promise<void>,
  onError: (error: unknown) => void = console.error
) {
  let closing: Promise<void> | null = null;
  return () => {
    if (!closing) {
      closing = close().catch((error) => {
        onError(error);
        throw error;
      });
    }
    return closing;
  };
}

export function registerProcessShutdown(
  shutdown: () => Promise<void>
) {
  const handlers = new Map<RuntimeSignal, () => void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
}
