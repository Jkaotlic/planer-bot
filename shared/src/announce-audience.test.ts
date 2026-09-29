import { describe, it, expect } from "vitest";
import { announcementRole, presetRecipientIds, type AnnouncementRecipient } from "./announce-audience";

const r = (id: number, role: AnnouncementRecipient["role"]): AnnouncementRecipient =>
  ({ id, displayName: `#${id}`, reachable: true, role });

describe("announcementRole", () => {
  it("админ, работник, наблюдатель", () => {
    expect(announcementRole({ isAdmin: true, isObserver: false })).toBe("admin");
    expect(announcementRole({ isAdmin: false, isObserver: false })).toBe("worker");
    expect(announcementRole({ isAdmin: false, isObserver: true })).toBe("observer");
  });

  it("админ-наблюдатель — наблюдатель: его просили не учитывать в обеих кнопках", () => {
    expect(announcementRole({ isAdmin: true, isObserver: true })).toBe("observer");
  });
});

describe("presetRecipientIds", () => {
  const roster = [r(1, "admin"), r(2, "worker"), r(3, "observer"), r(4, "worker"), r(5, "admin")];

  it("«Админам» — только админы", () => {
    expect(presetRecipientIds(roster, "admins")).toEqual([1, 5]);
  });

  it("«Работникам» — не админы и не наблюдатели", () => {
    expect(presetRecipientIds(roster, "workers")).toEqual([2, 4]);
  });

  it("наблюдатель не попадает ни в одну кнопку", () => {
    expect([...presetRecipientIds(roster, "admins"), ...presetRecipientIds(roster, "workers")]).not.toContain(3);
  });
});
