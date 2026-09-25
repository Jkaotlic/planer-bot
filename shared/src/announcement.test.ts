import { describe, expect, it } from "vitest";
import { announcementUnreachableLine } from "./announcement";

describe("announcementUnreachableLine", () => {
  it("пусто и там, и там — строки нет", () => {
    expect(announcementUnreachableLine([], 0)).toBeNull();
  });

  it("только именованный без Telegram", () => {
    expect(announcementUnreachableLine(["Марк"], 0)).toBe("Не дошло: Марк (нет Telegram)");
  });

  it("только архивные — числом, без единого имени", () => {
    const line = announcementUnreachableLine([], 2);
    expect(line).toBe("Не дошло: ещё 2 — в архиве");
    expect(line).not.toContain("Семён");
  });

  it("и то, и то — сначала именованные, потом счётчик архива", () => {
    expect(announcementUnreachableLine(["Марк"], 2)).toBe("Не дошло: Марк (нет Telegram); ещё 2 — в архиве");
  });
});
