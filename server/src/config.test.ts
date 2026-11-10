import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

const base = {
  BOT_TOKEN: "123:abc",
  ADMIN_TELEGRAM_IDS: "111, 222",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough-0123",
  PUBLIC_URL: "https://planner.example.com",
};

describe("loadConfig", () => {
  it("виджет выключен по умолчанию и включается только явным true", () => {
    expect(loadConfig(base).myWeekWidgetEnabled).toBe(false);
    expect(loadConfig({ ...base, MY_WEEK_WIDGET_ENABLED: "false" }).myWeekWidgetEnabled).toBe(false);
    expect(loadConfig({ ...base, MY_WEEK_WIDGET_ENABLED: "true" }).myWeekWidgetEnabled).toBe(true);
    expect(() => loadConfig({ ...base, MY_WEEK_WIDGET_ENABLED: "yes" })).toThrow(/MY_WEEK_WIDGET_ENABLED/);
  });
  it("parses a valid env with defaults", () => {
    const cfg = loadConfig(base);
    expect(cfg.adminTelegramIds).toEqual([111, 222]);
    expect(cfg.teamTz).toBe("Europe/Moscow"); // default
    expect(cfg.databaseUrl).toBe("./data/planer.db"); // default
    expect(cfg.botToken).toBe("123:abc");
  });

  it("honors an explicit TEAM_TZ", () => {
    expect(loadConfig({ ...base, TEAM_TZ: "Asia/Yekaterinburg" }).teamTz).toBe("Asia/Yekaterinburg");
  });

  it("throws when a required var is missing", () => {
    const { BOT_TOKEN, ...rest } = base;
    expect(() => loadConfig(rest)).toThrow(/BOT_TOKEN/);
  });

  it("throws on a non-integer admin id", () => {
    expect(() => loadConfig({ ...base, ADMIN_TELEGRAM_IDS: "111, oops" })).toThrow();
  });

  it("throws when there are no admin ids (empty deploy bootstraps nobody)", () => {
    expect(() => loadConfig({ ...base, ADMIN_TELEGRAM_IDS: "" })).toThrow();
  });

  it("throws on an invalid IANA timezone", () => {
    expect(() => loadConfig({ ...base, TEAM_TZ: "Not/AZone" })).toThrow();
  });
});
