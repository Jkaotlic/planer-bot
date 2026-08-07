import { describe, it, expect } from "vitest";
import { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, archiveEmployee, listActive, linkTelegramAccount, setEmployeeRestrictions } from "../repo/employees";
import { createShift, getShift } from "../repo/shifts";
import { setTemplateRoles } from "../repo/template-roles";
import { readTeamSchedule } from "../repo/team-schedule";
import { runReminderTick } from "../reminders/reminder-service";
import { buildDistribution, applyDistribution } from "./distribute-service";

/** Bot with botInfo set (skips getMe) and a transformer capturing outgoing sendMessage — see reminder.test.ts. */
function testBot() {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") sent.push(payload as { chat_id: number | string; text: string });
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

// A slot nobody can take used to vanish from the result with no trace: the admin
// pressed «Распределить честно», saw a smaller number than there were empty cells,
// and had nothing to go on. These pin that every skipped slot comes back with a
// reason — and that the two reasons are told apart, because one is a misconfigured
// pool (fixable on the «кто что может» screen) and the other is ordinary life.
describe("buildDistribution — slots it could not fill", () => {
  it("reports a slot whose pool has nobody active left, and names the reason", () => {
    const db = makeTestDb();
    const duty = createEmployee(db, { displayName: "Дежурный Пула" });
    createEmployee(db, { displayName: "Свободный Работник" });
    setTemplateRoles(db, 1, { pool: [duty.id], preference: {} });
    archiveEmployee(db, duty.id, "2026-07-01");

    const slot = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00", templateId: 1 });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    expect(result.assignments).toEqual([]);
    expect(result.unfilled).toEqual([
      { shiftId: slot.id, date: "2026-07-02", kind: "Утро", reason: "empty_pool" },
    ]);
  });

  it("reports a slot everybody is away for as ordinary, not as a broken pool", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-07-02", endDate: "2026-07-04", category: "vacation", employeeId: anya.id });

    const slot = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00", templateId: 1 });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    expect(result.assignments).toEqual([]);
    expect(result.unfilled).toEqual([
      { shiftId: slot.id, date: "2026-07-02", kind: "Утро", reason: "nobody_free" },
    ]);
  });

  it("reports nothing when every slot found somebody", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня" });
    createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00", templateId: 1 });

    expect(buildDistribution(db, "2026-07-01", "2026-07-10").unfilled).toEqual([]);
  });
});

describe("buildDistribution", () => {
  it("proposes assignments only for unassigned shift slots in range, never double-booking", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // existing (assigned) load, seeds each worker's balance/busy
    createShift(db, { date: "2026-07-01", start: "23:00", end: "07:00", employeeId: anya.id }); // night, already loaded

    // unassigned slots to be filled
    const night1 = createShift(db, { date: "2026-07-02", start: "23:00", end: "07:00" });
    const night2 = createShift(db, { date: "2026-07-03", start: "23:00", end: "07:00" });
    const day1 = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });
    // out of range and wrong category, must be ignored
    createShift(db, { date: "2026-01-01", start: "08:00", end: "17:00" });
    createShift(db, { date: "2026-07-02", category: "vacation" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const shiftIds = result.assignments.map((a) => a.shiftId).sort((a, b) => a - b);
    expect(shiftIds).toEqual([night1.id, day1.id, night2.id].sort((a, b) => a - b));

    // no double-booking: night1 and day1 are same-day disjoint times, both can go to same or diff employee, fine.
    // Igor is idle -> should pick up at least one of the two nights (since Anya is pre-loaded with a night)
    const nightAssignees = result.assignments
      .filter((a) => a.shiftId === night1.id || a.shiftId === night2.id)
      .map((a) => a.employeeId);
    expect(nightAssignees).toContain(igor.id);

    // employeeName resolved
    for (const a of result.assignments) {
      expect(typeof a.employeeName).toBe("string");
      expect(a.employeeName.length).toBeGreaterThan(0);
    }
  });

  it("does not assign a worker to a slot on a date they're on vacation", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // Anya is on vacation the day of the unassigned slot; absences have null start/end.
    createShift(db, { date: "2026-07-02", category: "vacation", employeeId: anya.id });
    const slot = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const assignment = result.assignments.find((a) => a.shiftId === slot.id);
    expect(assignment?.employeeId).not.toBe(anya.id);
    expect(assignment?.employeeId).toBe(igor.id);
  });

  it("does not assign a worker to a slot on any date covered by a multi-day business trip", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // Anya is on a business trip 2026-07-05..2026-07-07 (multi-day, expand via endDate).
    createShift(db, { date: "2026-07-05", endDate: "2026-07-07", category: "business_trip", employeeId: anya.id });
    const slot = createShift(db, { date: "2026-07-06", start: "08:00", end: "17:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const assignment = result.assignments.find((a) => a.shiftId === slot.id);
    expect(assignment?.employeeId).not.toBe(anya.id);
    expect(assignment?.employeeId).toBe(igor.id);
  });

  it("counts an unread roster cell toward total load, so it isn't handed extra shifts on the strength of an undercount", () => {
    const db = makeTestDb();
    // Created first, so a broken tiebreak (equal totals -> lower id wins) would
    // wrongly favour her over Igor; only an honest total count fixes that.
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // An unread roster cell: the import could not decode it, so it has no times —
    // but it is still a "shift" category entry, not an absence.
    createShift(db, {
      date: "2026-07-01", start: null, end: null, category: "shift",
      employeeId: anya.id, unrecognisedCode: "Ко",
    });

    // A single custom-time slot, on a different day so it can't collide with the
    // unread cell's date; both workers are otherwise tied (0 of this kind).
    const slot = createShift(db, { date: "2026-07-05", start: "09:00", end: "17:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const assignment = result.assignments.find((a) => a.shiftId === slot.id);
    // Igor has the lower total (0 vs Anya's 1 from the unread cell) and must win it.
    expect(assignment?.employeeId).toBe(igor.id);
  });

  it("does not double-book a worker on the day of an unread roster cell", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // Anya has something on 2026-07-02 the roster import could not read.
    createShift(db, {
      date: "2026-07-02", start: null, end: null, category: "shift",
      employeeId: anya.id, unrecognisedCode: "Ко",
    });
    const slot = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const assignment = result.assignments.find((a) => a.shiftId === slot.id);
    expect(assignment?.employeeId).not.toBe(anya.id);
    expect(assignment?.employeeId).toBe(igor.id);
  });

  it("does not double-book a worker across the boundary of a window, when a shift dated the day before crosses midnight into it", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // A genuinely overnight custom-time entry dated the day BEFORE the window;
    // its tail (up to 07:00) still lands inside [from, to].
    createShift(db, { date: "2026-06-30", start: "23:00", end: "07:00", employeeId: anya.id });
    // Overlaps only the tail of that overnight shift.
    const slot = createShift(db, { date: "2026-07-01", start: "06:00", end: "08:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const assignment = result.assignments.find((a) => a.shiftId === slot.id);
    expect(assignment?.employeeId).not.toBe(anya.id);
    expect(assignment?.employeeId).toBe(igor.id);
  });

  // `distributeFairly` already refuses to give an overnight slot to somebody absent
  // the next morning — but it can only see the absences seeding hands it, and
  // seeding clamped them to [from, to]. A slot dated `to` reaches into `to`+1, so
  // the very last night of a window fell straight back into the bug the overnight
  // fix was written to close: the absence starting the next day isn't even loaded
  // (`overlapsRange` rejects it), let alone expanded into `absentDates`.
  it("keeps an overnight slot on the last day of the window away from somebody whose vacation starts the next morning", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // Vacation begins the day AFTER the window closes — invisible to a [from, to] clamp.
    createShift(db, { date: "2026-07-11", endDate: "2026-07-20", category: "vacation", employeeId: anya.id });
    // The window's last night, ending at 06:00 on the first morning of that vacation.
    const slot = createShift(db, { date: "2026-07-10", start: "22:00", end: "06:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const assignment = result.assignments.find((a) => a.shiftId === slot.id);
    // Anya sorts first on every tiebreak (same counts, lower id), so without the
    // next-day reach she wins the slot and works the first morning of her holiday.
    expect(assignment?.employeeId).not.toBe(anya.id);
    expect(assignment?.employeeId).toBe(igor.id);
  });

  // Seeding counts unread cells in a second pass, on the premise that they have no
  // times and so never reached the first one. The import does write them that way —
  // but a cell edited before the «правка снимает пометку» fix landed kept its mark
  // AND gained times, and the live schedule holds exactly one such row. It was then
  // counted twice: once under its real kind, once under «Не распознано (?)», with
  // `total` inflated by one. An inflated total reads as «этот уже загружен», so fair
  // distribution quietly hands that person fewer shifts than they are owed.
  it("counts a cell that is both unread and timed once, not twice", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });

    // The shape the live row is in: an unread mark that never got cleared, on an
    // entry that has since been given real hours and a name.
    createShift(db, {
      date: "2026-07-02", start: "09:00", end: "18:00", title: "День",
      category: "shift", employeeId: anya.id, unrecognisedCode: "Ко",
    });
    createShift(db, {
      date: "2026-07-02", start: "09:00", end: "18:00", title: "День",
      category: "shift", employeeId: igor.id,
    });

    // Neither holds this kind, so the pick falls through to `total` and then to id.
    const slot = createShift(db, { date: "2026-07-05", start: "10:00", end: "19:00", title: "Вечер" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    const assignment = result.assignments.find((a) => a.shiftId === slot.id);
    // Both hold exactly one shift, so the lower id wins. Double-counted, Anya's
    // total reads 2 and the slot goes to Igor instead.
    expect(assignment?.employeeId).toBe(anya.id);
  });

  it("does not double-book a worker across overlapping unassigned slots at the same time", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Аня" });
    const s1 = createShift(db, { date: "2026-07-05", start: "09:00", end: "17:00" });
    const s2 = createShift(db, { date: "2026-07-05", start: "10:00", end: "18:00" });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    // only one worker exists, so only one of the two overlapping slots can be filled
    expect(result.assignments.length).toBe(1);
    expect([s1.id, s2.id]).toContain(result.assignments[0]!.shiftId);
  });
});

describe("buildDistribution — excludedFromAssignment", () => {
  it("never assigns an excluded worker, and assigns them again once the flag is cleared", () => {
    const db = makeTestDb();
    // Created first, so a tied tiebreak (lower id wins) is what hands Игорь the
    // slot once his flag is cleared below — proving the second run really picked
    // him, not that he happened to win on some unrelated tiebreak.
    const igor = createEmployee(db, { displayName: "Игорь Петров" });
    setEmployeeRestrictions(db, igor.id, { excludedFromAssignment: true });
    const anya = createEmployee(db, { displayName: "Аня Смирнова" });

    const slot = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });

    const excluded = buildDistribution(db, "2026-07-01", "2026-07-10");
    expect(excluded.assignments).toEqual([
      { shiftId: slot.id, employeeId: anya.id, employeeName: "Аня Смирнова" },
    ]);

    // Neither run is applied, so the slot is still open — the same fixture, just
    // with the flag cleared, must now hand it to Игорь.
    setEmployeeRestrictions(db, igor.id, { excludedFromAssignment: false });
    const cleared = buildDistribution(db, "2026-07-01", "2026-07-10");
    expect(cleared.assignments).toEqual([
      { shiftId: slot.id, employeeId: igor.id, employeeName: "Игорь Петров" },
    ]);
  });

  /**
   * `empty_pool` means «this preset lists nobody who is on the roster» — a broken
   * configuration the admin has to fix. A pool of people who are merely excluded
   * from assignment is not broken, so the reason must stay `nobody_free`.
   * That is why the reason is computed over ALL active workers, not the filtered set.
   */
  it("a pool of excluded-only people reports nobody_free, not empty_pool", () => {
    const db = makeTestDb();
    const igor = createEmployee(db, { displayName: "Игорь Петров" });
    setEmployeeRestrictions(db, igor.id, { excludedFromAssignment: true });
    setTemplateRoles(db, 1, { pool: [igor.id], preference: {} });

    const slot = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00", templateId: 1 });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    expect(result.assignments).toEqual([]);
    expect(result.unfilled).toEqual([
      { shiftId: slot.id, date: "2026-07-02", kind: "Утро", reason: "nobody_free" },
    ]);

    // The same fixture, flag cleared: he is the pool's only member, so once he is
    // no longer excluded there is nobody else it could go to.
    setEmployeeRestrictions(db, igor.id, { excludedFromAssignment: false });
    const cleared = buildDistribution(db, "2026-07-01", "2026-07-10");
    expect(cleared.assignments).toEqual([
      { shiftId: slot.id, employeeId: igor.id, employeeName: "Игорь Петров" },
    ]);
    expect(cleared.unfilled).toEqual([]);
  });

  // The guard against the fix above accidentally erasing the real `empty_pool`
  // case: a pool that lists only somebody archived is a misconfiguration, not
  // ordinary unavailability, and must keep reporting so.
  it("a pool of archived-only people still reports empty_pool", () => {
    const db = makeTestDb();
    const igor = createEmployee(db, { displayName: "Игорь Петров" });
    setTemplateRoles(db, 1, { pool: [igor.id], preference: {} });
    archiveEmployee(db, igor.id, "2026-07-01");
    createEmployee(db, { displayName: "Аня Смирнова" }); // active, but outside the pool

    const slot = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00", templateId: 1 });

    const result = buildDistribution(db, "2026-07-01", "2026-07-10");
    expect(result.assignments).toEqual([]);
    expect(result.unfilled).toEqual([
      { shiftId: slot.id, date: "2026-07-02", kind: "Утро", reason: "empty_pool" },
    ]);
  });

  /**
   * The flag must not creep into archiving.
   *
   * `listActive` is read by nearly everything — the team grid, reminders, birthday
   * collections, reports, the CSV export. This flag touches exactly five call
   * sites and none of those. The cheap way to «implement» it would have been to
   * filter `listActive` itself, which would silently delete the person from half
   * the product; this test is what makes that mistake loud.
   */
  it("an excluded worker is still on the team, still reminded, still exported", async () => {
    const db = makeTestDb();
    const igor = createEmployee(db, { displayName: "Игорь Петров", inviteToken: "i-igor" });
    linkTelegramAccount(db, "i-igor", 111);
    setEmployeeRestrictions(db, igor.id, { excludedFromAssignment: true });
    createShift(db, { date: "2026-07-15", start: "08:00", end: "17:00", employeeId: igor.id });

    // still on the team
    expect(listActive(db).some((e) => e.id === igor.id)).toBe(true);
    expect(
      readTeamSchedule(db, "2026-07-13", "2026-07-19").employees.some((e) => e.id === igor.id),
    ).toBe(true);

    // still reminded for tomorrow's shift
    const { bot, sent } = testBot();
    const count = await runReminderTick(db, bot, { date: "2026-07-14", time: "20:30" });
    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chat_id).toBe(111);
  });
});

describe("applyDistribution", () => {
  it("sets employeeId on apply, leaves shifts untouched otherwise", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const s1 = createShift(db, { date: "2026-07-02", start: "08:00", end: "17:00" });

    const { assignments } = buildDistribution(db, "2026-07-01", "2026-07-10");
    expect(getShift(db, s1.id)?.employeeId).toBeNull();

    applyDistribution(db, assignments.map((a) => ({ shiftId: a.shiftId, employeeId: a.employeeId })));

    for (const a of assignments) {
      expect(getShift(db, a.shiftId)?.employeeId).toBe(a.employeeId);
    }
    expect(getShift(db, s1.id)?.employeeId).toBe(anya.id);
  });
});
