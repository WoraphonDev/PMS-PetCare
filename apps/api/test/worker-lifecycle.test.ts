import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { waitForShutdown } from "../src/worker-lifecycle";

describe("waitForShutdown", () => {
  it.each(["SIGTERM", "SIGINT"])("holds the event loop open until %s, then closes once", async (signal) => {
    const signals = new EventEmitter();
    const close = vi.fn(async () => {});
    const { stopped, keepAlive } = waitForShutdown(signals, close);

    let done = false;
    void stopped.then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    expect(keepAlive.hasRef()).toBe(true);

    signals.emit(signal);
    signals.emit("SIGTERM");
    await stopped;
    expect(close).toHaveBeenCalledTimes(1);
    expect(signals.listenerCount("SIGTERM") + signals.listenerCount("SIGINT")).toBe(0);
  });
});
