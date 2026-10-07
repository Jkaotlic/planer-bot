import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { eachDayIso, parseCoverage, weekdayIndex } from "@planer/shared";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { listActiveTemplates, setCoverage } from "../repo/templates";
import { setManualDay } from "../repo/calendar-days";
import { ackCoverageDate } from "../repo/settings";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const bearer = (t: string) => ({ headers: { Authorization: `Bearer ${t}` } });

function worker(db: Db, name: string, tgId: number) {
  const w = createEmployee(db, { displayName: name, inviteToken: `inv-${tgId}` });
  linkTelegramAccount(db, `inv-${tgId}`, tgId);
  return w;
}

// The team's today is Wednesday 26 Aug; the window is Wed 26 … Tue 1 Sep.
// Only `Date` is faked: the JWT and the HTTP stack keep real timers.
const FROM = "2026-08-26";
const TO = "2026-09-01";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-26T09:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

function morning(db: Db) {
  const found = listActiveTemplates(db).find((t) => t.name === "Утро");
  if (!found) throw new Error("no «Утро» preset");
  return found;
}

/** Seed norms are all zero, so the test gives «Утро» one — Mon 3, Tue–Fri 2. */
async function setup() {
  const db = makeTestDb();
  setCoverage(db, morning(db).id, "3,2,2,2,2,0,0");
  const app = createApp({ db, config });
  const admin = await tokenFor(app, 111);
  worker(db, "Игорь", 333);
  const workerToken = await tokenFor(app, 333);
  return { db, app, admin, workerToken };
}

/** Staffs every active kind to its norm on every day of [from, to] except `opts.skip`. */
function fillWindow(db: Db, from: string, to: string, opts: { skip?: string } = {}) {
  const people = [worker(db, "Аня", 201), worker(db, "Марк", 202), worker(db, "Лена", 203)];
  for (const template of listActiveTemplates(db)) {
    const coverage = parseCoverage(template.coverage);
    for (const date of eachDayIso(from, to)) {
      if (date === opts.skip) continue;
      const need = coverage[weekdayIndex(date)] ?? 0;
      for (const person of people.slice(0, need)) {
        createShift(db, { date, start: "08:00", end: "17:00", employeeId: person.id, category: template.category, templateId: template.id });
      }
    }
  }
}

const shortfall = async (app: ReturnType<typeof createApp>, token: string) =>
  (await app.request("/api/admin/shortfall", bearer(token))).json();

describe("GET /api/admin/shortfall", () => {
  it("counts people missing over seven days starting from the team's today", async () => {
    // Wed–Fri need 2 each, Mon needs 3, Tue needs 2: 2+2+2+3+2 = 11. Monday 24
    // and Tuesday 25 are before the window and must not be counted.
    const { app, admin } = await setup();
    expect(await shortfall(app, admin)).toEqual({ total: 11, firstDate: FROM });
  });

  it("ignores days before today even when they are short", async () => {
    // The window is closed by hand; Monday 24 and Tuesday 25 stay empty.
    const { app, admin, db } = await setup();
    fillWindow(db, FROM, TO);
    expect(await shortfall(app, admin)).toEqual({ total: 0, firstDate: null });
  });

  it("a multi-day entry that started before the window still covers its days", async () => {
    // Norm 1 every day: a bare window is short by 7. A week-long entry that began
    // on Monday 24 covers 26, 27 and 28 — the badge must not ask for them again.
    const { app, admin, db } = await setup();
    setCoverage(db, morning(db).id, "1,1,1,1,1,1,1");
    expect(await shortfall(app, admin)).toEqual({ total: 7, firstDate: FROM });
    const anya = worker(db, "Аня", 201);
    createShift(db, {
      date: "2026-08-24", endDate: "2026-08-28", start: "08:00", end: "17:00",
      employeeId: anya.id, category: "shift", templateId: morning(db).id,
    });
    expect(await shortfall(app, admin)).toEqual({ total: 4, firstDate: "2026-08-29" });
  });

  it("a weekday holiday inside the window is counted by the Sunday norm", async () => {
    // Thursday 27 is left empty: it needs 2 people by its own norm. Marked a
    // holiday it falls to Sunday's norm, which is zero, so nothing is missing.
    const { app, admin, db } = await setup();
    fillWindow(db, FROM, TO, { skip: "2026-08-27" });
    expect(await shortfall(app, admin)).toEqual({ total: 2, firstDate: "2026-08-27" });
    setManualDay(db, "2026-08-27", "holiday", null, new Date());
    expect(await shortfall(app, admin)).toEqual({ total: 0, firstDate: null });
  });

  it("an acknowledged day («Знаю про дату») is not a shortfall: total and firstDate skip it, and a fresh ack shows on the next read", async () => {
    const { app, admin, db } = await setup();
    fillWindow(db, FROM, TO, { skip: "2026-08-27" });
    expect(await shortfall(app, admin)).toEqual({ total: 2, firstDate: "2026-08-27" });
    ackCoverageDate(db, "2026-08-27");
    expect(await shortfall(app, admin)).toEqual({ total: 0, firstDate: null });
  });

  it("GET /api/admin/coverage-acks lists acknowledged dates of the range, admin only, capped at 31 days", async () => {
    const { app, admin, db, workerToken } = await setup();
    ackCoverageDate(db, "2026-08-27");
    ackCoverageDate(db, "2026-09-20");
    const read = async (qs: string, token = admin) => app.request(`/api/admin/coverage-acks?${qs}`, bearer(token));
    const ok = await read("from=2026-08-24&to=2026-08-30");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ dates: ["2026-08-27"] });
    expect(await (await read("from=2026-08-24&to=2026-09-23")).json()).toEqual({ dates: ["2026-08-27", "2026-09-20"] });
    expect((await read("from=2026-08-24&to=2026-09-24")).status).toBe(400);
    expect((await read("from=2026-08-30&to=2026-08-24")).status).toBe(400);
    expect((await read("from=nope&to=2026-08-24")).status).toBe(400);
    expect((await read("from=2026-08-24&to=2026-08-30", workerToken)).status).toBe(403);
  });

  it("starts the window from the team date, not the UTC date, near midnight", async () => {
    // 22:30Z on 26 Aug is already 01:30 on Thursday 27 Aug in Europe/Moscow
    // (testConfig), so the UTC date and the team date really differ here.
    vi.setSystemTime(new Date("2026-08-26T22:30:00Z"));
    const { app, admin } = await setup();
    expect(await shortfall(app, admin)).toEqual({ total: 11, firstDate: "2026-08-27" });
  });

  it("refuses a non-admin", async () => {
    const { app, admin, workerToken } = await setup();
    // The same route answers an admin: without this a missing route (404) would pass for «refused».
    expect((await app.request("/api/admin/shortfall", bearer(admin))).status).toBe(200);
    expect((await app.request("/api/admin/shortfall", bearer(workerToken))).status).toBe(403);
  });
});
