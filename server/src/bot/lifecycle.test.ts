import { afterEach, describe, expect, it, vi } from "vitest";
import { stopBotSafely } from "./lifecycle";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stopBotSafely", () => {
  it("resolves a rejected stop and logs only the sanitized message", async () => {
    const credential = "1234567890:abcdefghijklmnopqrstuvwxyz_ABCDEF";
    const logged: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });
    const bot = {
      stop: async () => {
        throw new Error(
          `request to https://api.telegram.org/bot${credential}/getUpdates failed`,
        );
      },
    };

    await expect(stopBotSafely(bot)).resolves.toBeUndefined();

    expect(logged).toEqual([
      [
        "bot failed to stop:",
        "request to https://api.telegram.org/bot[REDACTED_BOT_TOKEN]/getUpdates failed",
      ],
    ]);
    expect(JSON.stringify(logged)).not.toContain(credential);
  });
});
