import { describe, it, expect, vi } from "vitest";
import { runTicksIndependently, createTickScheduler } from "./ticks";

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

describe("createTickScheduler", () => {
  // Один общий флаг «идёт» держал все тики, пока не кончится самый медленный:
  // напоминание с таймаутами Telegram по 20 с на человека задерживало эскалацию
  // «смену никто не взял» на следующий пятиминутный круг и дальше.
  it("медленный тик не задерживает соседа, а сам не накладывается на себя", async () => {
    let slowRuns = 0;
    let fastRuns = 0;
    let release!: () => void;
    const slowGate = new Promise<void>((r) => { release = r; });
    const round = createTickScheduler([
      { name: "slow", run: async () => { slowRuns += 1; await slowGate; } },
      { name: "fast", run: async () => { fastRuns += 1; } },
    ]);

    round();
    await new Promise((r) => setTimeout(r, 0));
    round();
    await new Promise((r) => setTimeout(r, 0));

    expect(fastRuns).toBe(2);
    expect(slowRuns).toBe(1);

    release();
    await new Promise((r) => setTimeout(r, 0));
    round();
    await new Promise((r) => setTimeout(r, 0));
    expect(slowRuns).toBe(2);
  });

  it("упавший тик снимает свой флаг — следующий круг его запускает", async () => {
    let runs = 0;
    const round = createTickScheduler([{ name: "boom", run: async () => { runs += 1; throw new Error("x"); } }]);
    round();
    await new Promise((r) => setTimeout(r, 0));
    round();
    await new Promise((r) => setTimeout(r, 0));
    expect(runs).toBe(2);
  });
});
