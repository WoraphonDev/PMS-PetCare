import type { EventEmitter } from "node:events";

/**
 * Keeps the worker process alive until SIGTERM / SIGINT, then runs `close` once.
 * Signal listeners alone do not hold Node's event loop open, so a ref'd timer does until shutdown.
 */
export function waitForShutdown(signals: Pick<EventEmitter, "once" | "off">, close: () => Promise<void>) {
  const keepAlive = setInterval(() => {}, 1 << 30);
  const stopped = new Promise<void>((resolve, reject) => {
    const stop = () => {
      signals.off("SIGTERM", stop);
      signals.off("SIGINT", stop);
      clearInterval(keepAlive);
      close().then(resolve, reject);
    };
    signals.once("SIGTERM", stop);
    signals.once("SIGINT", stop);
  });
  return { stopped, keepAlive };
}
