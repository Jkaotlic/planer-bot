import { describe, expect, it } from "vitest";
import { HttpError } from "grammy";
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

describe("safeErrorMessage: причина сетевой ошибки grammY", () => {
  it("печатает, почему запрос не дошёл, — и с вырезанным токеном", () => {
    const credential = "1234567890:abcdefghijklmnopqrstuvwxyz_ABCDEF";
    const cause = new Error(
      `request to https://api.telegram.org/bot${credential}/sendMessage failed, reason: getaddrinfo ENOTFOUND api.telegram.org`,
    );
    const error = new HttpError("Network request for 'sendMessage' failed!", cause);

    const message = safeErrorMessage(error);

    expect(message).toContain("Network request for 'sendMessage' failed!");
    expect(message).toContain("ENOTFOUND api.telegram.org");
    expect(message).not.toContain(credential);
  });
});
