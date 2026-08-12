import { describe, it, expect } from "vitest";
import { selfEntryCreatedText, selfEntryUpdatedText, selfEntryDeletedText } from "./self-entry-notice";

const sick = { category: "sick_leave" as const, date: "2026-08-12", endDate: "2026-08-14" };
const event = {
  category: "offsite" as const,
  date: "2026-08-20",
  start: "14:00",
  end: "16:00",
  title: "Конференция",
};

describe("what the admins read", () => {
  it("names the person, what they recorded and the span", () => {
    const text = selfEntryCreatedText("Аня", sick, []);
    expect(text).toContain("Аня");
    expect(text).toContain("больничный");
    expect(text).toContain("12 авг");
    expect(text).toContain("14 авг");
  });

  it("carries the day lines — that is what names the uncovered shift", () => {
    const text = selfEntryCreatedText("Аня", sick, ["На Ср 12 авг стоят: 09:00–18:00 · День."]);
    expect(text).toContain("09:00–18:00");
  });

  it("says nothing extra when no day is at risk", () => {
    expect(selfEntryCreatedText("Аня", sick, []).split("\n")).toHaveLength(1);
  });

  it("names an event by its own title, not by the category word alone", () => {
    const text = selfEntryCreatedText("Игорь", event, []);
    expect(text).toContain("Конференция");
    expect(text).toContain("14:00–16:00");
  });

  it("mentions the place only when there is one — an event in the office has no address", () => {
    expect(selfEntryCreatedText("Игорь", event, [])).not.toContain("·  ");
    expect(selfEntryCreatedText("Игорь", { ...event, location: "Поклонка" }, [])).toContain("Поклонка");
  });

  /** «поставил(а)» — та же форма, что во всех письмах бота: в базе есть имя, но не пол. */
  it("uses the genderless verb form the rest of the bot uses", () => {
    expect(selfEntryCreatedText("Аня", sick, [])).toContain("(а)");
  });

  it("an edit says what it was and what it became", () => {
    const after = { ...sick, endDate: "2026-08-16" };
    const text = selfEntryUpdatedText("Аня", sick, after, []);
    expect(text).toContain("14 авг");
    expect(text).toContain("16 авг");
  });

  it("a removal does not pretend anything is still standing", () => {
    const text = selfEntryDeletedText("Аня", sick);
    expect(text).toContain("снял(а)");
    expect(text).not.toContain("стоят");
  });

  it("a one-day sick leave is not written as a range from itself to itself", () => {
    const text = selfEntryCreatedText("Аня", { category: "sick_leave", date: "2026-08-12", endDate: "2026-08-12" }, []);
    expect(text).not.toContain("–");
  });
});
