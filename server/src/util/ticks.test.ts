import { describe, it, expect, vi } from "vitest";
import { runTicksIndependently } from "./ticks";

describe("runTicksIndependently", () => {
  it("runs every tick even when an earlier one rejects", async () => {
    const order: string[] = [];
    const failing = vi.fn(async () => {
      order.push("a");
      throw new Error("boom");
    });
    const succeeding = vi.fn(async () => {
      order.push("b");
    });

    await runTicksIndependently([
      { name: "a", run: failing },
      { name: "b", run: succeeding },
    ]);

    expect(failing).toHaveBeenCalledTimes(1);
    expect(succeeding).toHaveBeenCalledTimes(1);
    expect(order).toContain("a");
    expect(order).toContain("b");
  });

  it("never rejects itself, even when every tick throws", async () => {
    await expect(
      runTicksIndependently([
        { name: "a", run: () => Promise.reject(new Error("first")) },
        { name: "b", run: () => Promise.reject(new Error("second")) },
      ]),
    ).resolves.toBeUndefined();
  });

  it("logs each failure distinguishably, by the tick's own name", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runTicksIndependently([
        { name: "reminder", run: () => Promise.reject(new Error("reminder broke")) },
        { name: "birthday", run: () => Promise.resolve() },
      ]);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [prefix, message] = errorSpy.mock.calls[0]!;
      expect(prefix).toContain("reminder");
      expect(String(message)).toContain("reminder broke");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("still runs a synchronously-throwing tick's sibling", async () => {
    const succeeding = vi.fn(async () => {});
    await runTicksIndependently([
      {
        name: "sync-thrower",
        run: () => {
          throw new Error("thrown before any await");
        },
      },
      { name: "ok", run: succeeding },
    ]);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});
