import { describe, expect, it } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { clearDocPending, docPendingFor, startDocPending } from "./doc-pending";

describe("окно «жду файл инструкции»", () => {
  it("у каждого админа своё: второй админ не отнимает окно у первого", async () => {
    // Ключ был один на всех: пока админ А искал файл, админ Б нажимал
    // «приложить» к другому списку — и файл А молча никуда не прикладывался.
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Аня" }).id;
    const b = createEmployee(db, { displayName: "Игорь" }).id;
    const now = new Date();

    startDocPending(db, a, 1);
    startDocPending(db, b, 2);

    expect(docPendingFor(db, a, now)).toBe(1);
    expect(docPendingFor(db, b, now)).toBe(2);
  });

  it("закрытое одним админом окно не закрывает окно другого", async () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Аня" }).id;
    const b = createEmployee(db, { displayName: "Игорь" }).id;

    startDocPending(db, a, 1);
    startDocPending(db, b, 2);
    clearDocPending(db, b);

    expect(docPendingFor(db, a, new Date())).toBe(1);
    expect(docPendingFor(db, b, new Date())).toBeNull();
  });
});
