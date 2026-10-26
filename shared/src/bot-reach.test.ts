import { describe, expect, it } from "vitest";
import { cannotHearBot } from "./bot-reach";

const anya = { isActive: true, telegramUserId: 101, botBlockedAt: null };

describe("cannotHearBot — кому бот не может написать", () => {
  it("активный без Telegram — не слышит", () => {
    expect(cannotHearBot({ ...anya, telegramUserId: null })).toBe(true);
  });

  it("привязанный, но заблокировавший бота — не слышит", () => {
    expect(cannotHearBot({ ...anya, botBlockedAt: "2026-10-12T09:00:00.000Z" })).toBe(true);
  });

  it("архивный не считается, даже без Telegram и с блокировкой", () => {
    // Архивному бот не пишет нарочно — это не поломка, которую надо чинить.
    expect(cannotHearBot({ isActive: false, telegramUserId: null, botBlockedAt: "2026-10-12T09:00:00.000Z" })).toBe(false);
  });

  it("обычный привязанный без блокировки — слышит", () => {
    expect(cannotHearBot(anya)).toBe(false);
  });

  it("поле блокировки, которого сервер не прислал, — не блокировка", () => {
    expect(cannotHearBot({ isActive: true, telegramUserId: 101 })).toBe(false);
  });
});
