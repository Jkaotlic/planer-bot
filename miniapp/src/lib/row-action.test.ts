import { describe, expect, it, vi } from "vitest";
import { runRowAction } from "./row-action";

describe("runRowAction", () => {
  it("действие прошло, упало только перечитывание — это не отказ действия", async () => {
    // Обмен принят, а GET /api/swaps оборвался на релее: человек видел «Не
    // получилось принять», жал снова и получал настоящий отказ not_pending.
    const onActionFailed = vi.fn();
    const onRefreshFailed = vi.fn();

    await runRowAction({
      action: async () => {},
      refresh: async () => {
        throw new Error("network");
      },
      onActionFailed,
      onRefreshFailed,
    });

    expect(onActionFailed).not.toHaveBeenCalled();
    expect(onRefreshFailed).toHaveBeenCalledOnce();
  });

  it("отказ самого действия — отказ, и перечитывать нечего", async () => {
    const onActionFailed = vi.fn();
    const refresh = vi.fn(async () => {});

    await runRowAction({
      action: async () => {
        throw new Error("not_pending");
      },
      refresh,
      onActionFailed,
      onRefreshFailed: vi.fn(),
    });

    expect(onActionFailed).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });
});
