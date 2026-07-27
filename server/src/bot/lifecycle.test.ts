import { afterEach, describe, expect, it, vi } from "vitest";
import * as lifecycle from "./lifecycle";

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

    await expect(lifecycle.stopBotSafely(bot)).resolves.toBeUndefined();

    expect(logged).toEqual([
      [
        "bot failed to stop:",
        "request to https://api.telegram.org/bot[REDACTED_BOT_TOKEN]/getUpdates failed",
      ],
    ]);
    expect(JSON.stringify(logged)).not.toContain(credential);
  });

  it("closes HTTP and SQLite before exiting after a signal", async () => {
    const events: string[] = [];
    const shutdownSafely = (
      lifecycle as unknown as {
        shutdownSafely: (deps: {
          bot: { stop(): Promise<void> };
          closeHttp(): Promise<void>;
          closeDb(): void;
          exit(code: number): void;
        }) => Promise<void>;
      }
    ).shutdownSafely;

    await shutdownSafely({
      bot: { stop: async () => { events.push("bot"); } },
      closeHttp: async () => { events.push("http"); },
      closeDb: () => { events.push("db"); },
      exit: (code) => { events.push(`exit:${code}`); },
    });

    expect(events).toEqual(["bot", "http", "db", "exit:0"]);
  });
});
