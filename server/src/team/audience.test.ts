import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { archiveEmployee, createEmployee, linkTelegramAccount, setEmployeeObserver } from "../repo/employees";
import { shifts } from "../db/schema";
import type { Db } from "../db/client";
import { audienceCandidates, resolveAudience } from "./audience";

const today = "2026-09-29";

function person(db: Db, name: string, tg: number | null): number {
  const e = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  return e.id;
}

function shiftFor(db: Db, employeeId: number, category: "shift" | "vacation", date = today) {
  db.insert(shifts).values({ employeeId, category, date, start: category === "shift" ? "09:00" : null, end: category === "shift" ? "18:00" : null }).run();
}

describe("resolveAudience", () => {
  it("«вся команда» — активные без наблюдателей, запускающий первым", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const igor = person(db, "Игорь", 101);
    const mark = person(db, "Марк", 102);
    setEmployeeObserver(db, mark, true);
    const gone = person(db, "Лена", 103);
    archiveEmployee(db, gone, today);
    const { reachable } = resolveAudience(db, { kind: "team" }, igor, today);
    expect(reachable.map((e) => e.id)).toEqual([igor, anya]);
  });

  it("«сегодня на смене» — по графику, отпуск не считается, запускающий добавлен", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const igor = person(db, "Игорь", 101);
    const mark = person(db, "Марк", 102);
    shiftFor(db, igor, "shift");
    shiftFor(db, mark, "shift");
    shiftFor(db, mark, "vacation");
    const { reachable } = resolveAudience(db, { kind: "on_shift" }, anya, today);
    expect(reachable.map((e) => e.id)).toEqual([anya, igor]);
  });

  it("вручную — наблюдателя можно; архивного нельзя; без Telegram — в unreachable", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const mark = person(db, "Марк", 102);
    setEmployeeObserver(db, mark, true);
    const noTg = person(db, "Игорь", null);
    const gone = person(db, "Лена", 103);
    archiveEmployee(db, gone, today);
    const result = resolveAudience(db, { kind: "picked", employeeIds: [mark, noTg, gone, mark] }, anya, today);
    expect(result.reachable.map((e) => e.id)).toEqual([anya, mark]);
    expect(result.unreachable).toEqual(["Игорь"]);
  });
});

describe("audienceCandidates", () => {
  it("все активные, кроме смотрящего, с ролью и флагом «на смене»", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const igor = person(db, "Игорь", 101);
    const mark = person(db, "Марк", null);
    shiftFor(db, igor, "shift");
    const list = audienceCandidates(db, anya, today);
    expect(list).toEqual([
      { id: igor, displayName: "Игорь", reachable: true, role: "worker", onShift: true },
      { id: mark, displayName: "Марк", reachable: false, role: "worker", onShift: false },
    ]);
  });
});
