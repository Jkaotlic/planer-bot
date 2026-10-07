import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

const config = testConfig();

// Only `Date` is faked: the JWT and the HTTP stack keep real timers.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

async function meAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  const db = makeTestDb();
  const app = createApp({ db, config });
  createEmployee(db, { displayName: "Аня", inviteToken: "tok-9" });
  linkTelegramAccount(db, "tok-9", 9);
  const initData = signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 9, first_name: "T" }) }, config.botToken);
  const auth = await app.request(
    new Request("http://x/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData }) }),
  );
  const { token } = (await auth.json()) as { token: string };
  return (await app.request("/api/me", { headers: { Authorization: `Bearer ${token}` } })).json() as Promise<{ teamToday: string; teamTz: string }>;
}

describe("/api/me carries the team calendar date", () => {
  it("near midnight the team date is ahead of the UTC date (the console must not read the browser clock)", async () => {
    // 22:30Z on 26 Aug is 01:30 on 27 Aug in Europe/Moscow (testConfig).
    const me = await meAt("2026-08-26T22:30:00Z");
    expect(me.teamToday).toBe("2026-08-27");
    expect(me.teamTz).toBe("Europe/Moscow");
  });

  it("midday both calendars agree", async () => {
    expect((await meAt("2026-08-26T09:00:00Z")).teamToday).toBe("2026-08-26");
  });
});
