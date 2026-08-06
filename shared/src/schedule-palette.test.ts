import { describe, expect, it } from "vitest";
import {
  SCHEDULE_ACCENT_PALETTES,
  VACATION_SCHEDULE_PALETTE,
  UNRECOGNISED_SCHEDULE_PALETTE,
  exactSchedulePalette,
  CATEGORY_PALETTES_DARK,
  CATEGORY_PALETTES_LIGHT,
  categoryPalette,
} from "./schedule-palette";
import { templateAccents, entryCategorySchema } from "./category";

describe("working schedule palette", () => {
  it("matches every sampled colour and visible code", () => {
    expect(SCHEDULE_ACCENT_PALETTES).toEqual({
      blue: { bg: "#EAF0F0", fg: "#17202A", code: "Д" },
      gold: { bg: "#FEFF01", fg: "#17202A", code: "У" },
      violet: { bg: "#08AFF3", fg: "#062C3B", code: "В" },
      indigo: { bg: "#20497C", fg: "#FFFFFF", code: "Н" },
      rose: { bg: "#F2B07E", fg: "#17202A", code: "Т" },
      green: { bg: "#FFBE00", fg: "#17202A", code: "ВА" },
      teal: { bg: "#FE87FF", fg: "#39133A", code: "П" },
      amber: { bg: "#CBC04D", fg: "#292505", code: "07" },
      emerald: { bg: "#2F7D4F", fg: "#FFFFFF", code: "Р" },
    });
    expect(VACATION_SCHEDULE_PALETTE).toEqual({
      bg: "#FD0100",
      fg: "#FFFFFF",
      code: "О",
    });
  });

  it("gives every kind its own letter", () => {
    // Two kinds sharing a letter would be invisible: the week grid would draw the
    // same code for both, and the legend keys on it, so one line would silently
    // stand for two different squares.
    const codes = [
      ...Object.values(SCHEDULE_ACCENT_PALETTES).map((p) => p.code),
      VACATION_SCHEDULE_PALETTE.code,
      UNRECOGNISED_SCHEDULE_PALETTE.code,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("never uses the dot the grid reserves for a preset-less entry", () => {
    const codes = Object.values(SCHEDULE_ACCENT_PALETTES).map((p) => p.code);
    expect(codes).not.toContain("•");
    expect(VACATION_SCHEDULE_PALETTE.code).not.toBe("•");
    expect(UNRECOGNISED_SCHEDULE_PALETTE.code).not.toBe("•");
  });

  it("marks an unreadable cell with «?» and nothing else uses that letter", () => {
    // «?» has to stay unambiguous: it is the one square that means «мы не поняли
    // файл», and a preset claiming it would hide real cells behind that meaning.
    expect(UNRECOGNISED_SCHEDULE_PALETTE.code).toBe("?");
    expect(Object.values(SCHEDULE_ACCENT_PALETTES).map((p) => p.code)).not.toContain("?");
    expect(VACATION_SCHEDULE_PALETTE.code).not.toBe("?");
  });

  it("covers every accent a preset can claim", () => {
    // A preset whose accent has no palette entry falls back to the flat category
    // colour, so a new kind would silently render as «any other duty».
    for (const accent of templateAccents) {
      expect(SCHEDULE_ACCENT_PALETTES[accent], accent).toBeDefined();
    }
    expect(Object.keys(SCHEDULE_ACCENT_PALETTES).sort()).toEqual([...templateAccents].sort());
  });

  it("leaves unspecified categories to the existing theme palette", () => {
    expect(exactSchedulePalette(undefined, "sick_leave")).toBeNull();
    expect(exactSchedulePalette(undefined, "business_trip")).toBeNull();
    expect(exactSchedulePalette(undefined, "offsite")).toBeNull();
    expect(exactSchedulePalette(undefined, "weekend_work")).toBeNull();
  });
});

describe("палитра категорий", () => {
  it("покрывает каждую категорию в обеих темах", () => {
    for (const category of entryCategorySchema.options) {
      expect(CATEGORY_PALETTES_LIGHT[category], category).toBeDefined();
      expect(CATEGORY_PALETTES_DARK[category], category).toBeDefined();
    }
  });

  it("отпуск берёт свой точный цвет, а не категорийный", () => {
    // exactSchedulePalette знает отпуск в лицо — «О» на красном; категорийная
    // амбра сюда попасть не должна ни в светлой теме, ни в тёмной.
    expect(categoryPalette("vacation", false).bg).toBe("#FD0100");
    expect(categoryPalette("vacation", true).bg).toBe("#FD0100");
  });

  it("остальные категории различаются по теме", () => {
    expect(categoryPalette("shift", false)).not.toEqual(categoryPalette("shift", true));
  });
});
