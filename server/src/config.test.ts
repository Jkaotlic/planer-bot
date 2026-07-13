import { describe, it, expect } from "vitest";
import { loadConfig } from "./config";

const base = {
  BOT_TOKEN: "123:abc",
  ADMIN_TELEGRAM_IDS: "111, 222",
  JWT_SECRET: "s3cret-value-long-enough",
  PUBLIC_URL: "https://smeny.keenetic.pro",
};

describe("loadConfig", () => {
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
});
