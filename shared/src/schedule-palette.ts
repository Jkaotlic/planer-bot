import type { EntryCategory, TemplateAccent } from "./category";

export interface SchedulePalette {
  readonly bg: string;
  readonly fg: string;
  readonly code: string;
}

export const SCHEDULE_ACCENT_PALETTES: Record<TemplateAccent, SchedulePalette> = {
  blue: { bg: "#EAF0F0", fg: "#17202A", code: "С" },
  gold: { bg: "#FEFF01", fg: "#17202A", code: "У" },
  violet: { bg: "#08AFF3", fg: "#062C3B", code: "В" },
  indigo: { bg: "#20497C", fg: "#FFFFFF", code: "Н" },
  rose: { bg: "#F2B07E", fg: "#17202A", code: "Т" },
  green: { bg: "#FFBE00", fg: "#17202A", code: "ВА" },
  teal: { bg: "#FE87FF", fg: "#39133A", code: "П" },
  amber: { bg: "#CBC04D", fg: "#292505", code: "07" },
};

export const VACATION_SCHEDULE_PALETTE: SchedulePalette = {
  bg: "#FD0100",
  fg: "#FFFFFF",
  code: "О",
};

export function exactSchedulePalette(
  accent: TemplateAccent | undefined,
  category: EntryCategory,
): SchedulePalette | null {
  if (accent) return SCHEDULE_ACCENT_PALETTES[accent];
  return category === "vacation" ? VACATION_SCHEDULE_PALETTE : null;
}
