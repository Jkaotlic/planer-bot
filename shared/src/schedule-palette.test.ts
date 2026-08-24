import { describe, expect, it } from "vitest";
import {
  SCHEDULE_ACCENT_PALETTES,
  SICK_LEAVE_SCHEDULE_PALETTE,
  VACATION_SCHEDULE_PALETTE,
  WEEKEND_WORK_SCHEDULE_PALETTE,
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
      SICK_LEAVE_SCHEDULE_PALETTE.code,
      WEEKEND_WORK_SCHEDULE_PALETTE.code,
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

  /**
   * Точка осталась ровно у того, что и правда «какая-то запись»: смена или
   * дежурство своим временем, без вида. У состояний, которые команда читает в
   * сетке каждый день, буква есть у каждого.
   */
  it("без своего цвета остаются только смена и дежурство без вида", () => {
    expect(exactSchedulePalette(undefined, "shift")).toBeNull();
    expect(exactSchedulePalette(undefined, "duty")).toBeNull();
  });

  it("больничный носит своё «Б», а не общую точку", () => {
    expect(exactSchedulePalette(undefined, "sick_leave")).toEqual(SICK_LEAVE_SCHEDULE_PALETTE);
    expect(SICK_LEAVE_SCHEDULE_PALETTE.code).toBe("Б");
  });

  it("работа в выходной носит своё «РВ», а не общую точку", () => {
    // Две буквы — не выдумка: «ВА» и «07» стоят в сетке с самого начала, а все
    // однобуквенные варианты («В», «Р») уже заняты видами смен.
    expect(exactSchedulePalette(undefined, "weekend_work")).toEqual(WEEKEND_WORK_SCHEDULE_PALETTE);
    expect(WEEKEND_WORK_SCHEDULE_PALETTE.code).toBe("РВ");
  });

  it("мероприятие носит своё «М», а не общую точку", () => {
    expect(exactSchedulePalette(undefined, "offsite")?.code).toBe("М");
  });

  it("командировка носит своё «К», а не общую точку", () => {
    // Точка в сетке ничего не говорит: командировка — не «какая-то запись без
    // пресета», а понятное всей команде состояние, и у него есть буква.
    const trip = exactSchedulePalette(undefined, "business_trip");
    expect(trip?.code).toBe("К");
  });

  it("у каждого точного цвета он свой: ни одна пара не совпадает", () => {
    // Клетка в сетке — это 34×28 пикселей с одной буквой: два одинаковых фона
    // означают два состояния, которые на картинке не различить вовсе.
    const exact = [
      ...Object.values(SCHEDULE_ACCENT_PALETTES),
      VACATION_SCHEDULE_PALETTE,
      UNRECOGNISED_SCHEDULE_PALETTE,
      exactSchedulePalette(undefined, "business_trip")!,
      exactSchedulePalette(undefined, "offsite")!,
      SICK_LEAVE_SCHEDULE_PALETTE,
      WEEKEND_WORK_SCHEDULE_PALETTE,
    ];
    expect(new Set(exact.map((p) => p.bg)).size).toBe(exact.length);
    expect(new Set(exact.map((p) => p.code)).size).toBe(exact.length);
  });

  it("новые цвета не повторяют блёклые категорийные", () => {
    // Смысл правки был в том, чтобы командировку и мероприятие перестали путать
    // с соседними блёклыми состояниями, а не в том, чтобы перекрасить их в те же.
    const faded = [
      CATEGORY_PALETTES_LIGHT.offsite.bg,
      CATEGORY_PALETTES_LIGHT.business_trip.bg,
      CATEGORY_PALETTES_LIGHT.weekend_work.bg,
      CATEGORY_PALETTES_LIGHT.sick_leave.bg,
    ];
    expect(faded).not.toContain(exactSchedulePalette(undefined, "business_trip")!.bg);
    expect(faded).not.toContain(exactSchedulePalette(undefined, "offsite")!.bg);
    expect(faded).not.toContain(SICK_LEAVE_SCHEDULE_PALETTE.bg);
    expect(faded).not.toContain(WEEKEND_WORK_SCHEDULE_PALETTE.bg);
  });
});

describe("палитра категорий", () => {
  it("покрывает каждую категорию в обеих темах", () => {
    for (const category of entryCategorySchema.options) {
      expect(CATEGORY_PALETTES_LIGHT[category], category).toBeDefined();
      expect(CATEGORY_PALETTES_DARK[category], category).toBeDefined();
    }
  });

  it("мероприятие берёт свой точный цвет в обеих темах", () => {
    const event = exactSchedulePalette(undefined, "offsite")!;
    expect(categoryPalette("offsite", false).bg).toBe(event.bg);
    expect(categoryPalette("offsite", true).bg).toBe(event.bg);
  });

  it("командировка берёт свой точный цвет в обеих темах", () => {
    // Как и отпуск: у состояния, которое видно всей команде, цвет один и тот же
    // на картинке бота, в консоли и в мини-аппе.
    const trip = exactSchedulePalette(undefined, "business_trip")!;
    expect(categoryPalette("business_trip", false).bg).toBe(trip.bg);
    expect(categoryPalette("business_trip", true).bg).toBe(trip.bg);
  });

  it("больничный и работа в выходной берут свой точный цвет в обеих темах", () => {
    // Ровно то, зачем правка: цвет один и тот же на картинке бота, в консоли и
    // в мини-аппе, где тема телефона раньше меняла эти две клетки.
    for (const [category, palette] of [
      ["sick_leave", SICK_LEAVE_SCHEDULE_PALETTE],
      ["weekend_work", WEEKEND_WORK_SCHEDULE_PALETTE],
    ] as const) {
      expect(categoryPalette(category, false).bg, category).toBe(palette.bg);
      expect(categoryPalette(category, true).bg, category).toBe(palette.bg);
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
