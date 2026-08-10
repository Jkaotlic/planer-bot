import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { queryAudit, recordAudit } from "./audit";

describe("queryAudit and the viewer", () => {
  it("hides collection events about the viewer, keeps the rest", () => {
    const db = makeTestDb();
    const viewer = createEmployee(db, { displayName: "Viewer", inviteToken: "inv-v" }).id;
    const other = createEmployee(db, { displayName: "Other", inviteToken: "inv-o" }).id;

    recordAudit(db, "collection_sent", null, { employeeId: viewer, title: "Про смотрящего", delivered: 1, intended: 1 });
    recordAudit(db, "collection_sent", null, { employeeId: other, title: "Про другого", delivered: 1, intended: 1 });
    recordAudit(db, "collection_sent", null, { employeeId: null, title: "Общий", delivered: 1, intended: 1 });
    recordAudit(db, "entry_created", null, { employeeId: viewer, date: "2026-08-10" });

    const page = queryAudit(db, { limit: 50, offset: 0, viewerEmployeeId: viewer });
    const titles = page.rows.map((row) => (row.payload as { title?: string }).title ?? "запись");
    // Three rows must survive — the general one, the one about somebody else, and
    // an unrelated event type about the viewer themselves.
    expect(titles.sort()).toEqual(["Общий", "Про другого", "запись"]);
    // `total` must agree with the rows, or paging lies about how much is left.
    expect(page.total).toBe(3);
  });

  it("without a viewer nothing is hidden", () => {
    const db = makeTestDb();
    const viewer = createEmployee(db, { displayName: "Viewer", inviteToken: "inv-v" }).id;
    recordAudit(db, "collection_sent", null, { employeeId: viewer, title: "Про смотрящего", delivered: 1, intended: 1 });
    expect(queryAudit(db, { limit: 50, offset: 0 }).total).toBe(1);
  });
});
