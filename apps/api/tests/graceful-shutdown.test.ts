import { describe, expect, it, vi } from "vitest";
import { createShutdown } from "../src/utils/graceful-shutdown.js";

function setup(closeError?: Error) {
  const order: string[] = [];
  const exit = vi.fn((code: number) => void order.push(`exit:${code}`));
  const logger = { info: vi.fn(), error: vi.fn() };
  const server = {
    close: vi.fn((cb: (e?: Error) => void) => {
      order.push("close");
      cb(closeError);
    }),
    closeIdleConnections: vi.fn(),
  };
  const disconnect = vi.fn(async () => void order.push("disconnect"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { order, exit, disconnect, shutdown: createShutdown({ server: server as any, disconnect, logger: logger as any, exit }) };
}

describe("graceful shutdown", () => {
  it("closes the server, then the database, then exits cleanly", async () => {
    const { order, shutdown } = setup();
    await shutdown("SIGTERM");
    expect(order).toEqual(["close", "disconnect", "exit:0"]);
  });

  it("runs only once for repeated signals", async () => {
    const { disconnect, shutdown } = setup();
    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("exits with failure when closing fails", async () => {
    const { exit, shutdown } = setup(new Error("close failed"));
    await shutdown("SIGTERM");
    expect(exit).toHaveBeenCalledWith(1);
  });
});
