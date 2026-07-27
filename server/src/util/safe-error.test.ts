import { describe, expect, it } from "vitest";
import { safeErrorMessage } from "./safe-error";

describe("safeErrorMessage", () => {
  it("redacts Telegram bot credentials embedded in an API error URL", () => {
    const credential = "1234567890:abcdefghijklmnopqrstuvwxyz_ABCDEF";
    const error = new Error(
      `request to https://api.telegram.org/bot${credential}/getUpdates failed`,
    );

    const message = safeErrorMessage(error);

    expect(message).toBe(
      "request to https://api.telegram.org/bot[REDACTED_BOT_TOKEN]/getUpdates failed",
    );
    expect(message).not.toContain(credential);
  });
});
