import type { EntryCategory, TemplateAccent } from "./category";

export interface SchedulePalette {
  readonly bg: string;
  readonly fg: string;
  readonly code: string;
}

export const SCHEDULE_ACCENT_PALETTES: Record<TemplateAccent, SchedulePalette> = {
  // «Д» for «День», not «С» for «Смена»: every kind here is a смена, so «С» named
  // the category rather than this particular one, and sat in the grid next to
  // «У»/«В»/«Н» — which are all named after their own preset.
  blue: { bg: "#EAF0F0", fg: "#17202A", code: "Д" },
  gold: { bg: "#FEFF01", fg: "#17202A", code: "У" },
  violet: { bg: "#08AFF3", fg: "#062C3B", code: "В" },
  indigo: { bg: "#20497C", fg: "#FFFFFF", code: "Н" },
  rose: { bg: "#F2B07E", fg: "#17202A", code: "Т" },
  green: { bg: "#FFBE00", fg: "#17202A", code: "ВА" },
  teal: { bg: "#FE87FF", fg: "#39133A", code: "П" },
  amber: { bg: "#CBC04D", fg: "#292505", code: "07" },
  // Резерв. A real green — the `green` slot above is historically an orange, and
  // nothing else here is green, so a standby square reads apart from every kind
  // of actual shift at a glance. «Р» was the only free initial.
  emerald: { bg: "#2F7D4F", fg: "#FFFFFF", code: "Р" },
};

export const VACATION_SCHEDULE_PALETTE: SchedulePalette = {
  bg: "#FD0100",
  fg: "#FFFFFF",
  code: "О",
};

/**
 * Командировка.
 *
 * Своя палитра, а не «запись без пресета»: командировка — понятное всей команде
 * состояние, которое стоит в сетке рядом с отпуском, а не рядом с одноразовой
 * записью «своё время». Точка ничего о ней не говорила, буква говорит.
 *
 * Цвет насыщенный и свой: рядом бледно-сиреневое мероприятие и бледно-зелёная
 * работа в выходной, и командировку с ними путали именно потому, что все трое
 * были одинаково блёклыми.
 */
export const BUSINESS_TRIP_SCHEDULE_PALETTE: SchedulePalette = {
  bg: "#8E24AA",
  fg: "#FFFFFF",
  code: "К",
};

/**
 * A cell the import could not read — the file said something like «Ко» and we
 * refused to guess what it meant.
 *
 * Deliberately grey rather than red: nothing is broken in the schedule, we simply
 * did not understand one square, and it must not shout louder than a real absence.
 * It stays visible until somebody fixes the file, which is the point.
 */
export const UNRECOGNISED_SCHEDULE_PALETTE: SchedulePalette = {
  bg: "#6B7280",
  fg: "#FFFFFF",
  code: "?",
};

export function exactSchedulePalette(
  accent: TemplateAccent | undefined,
  category: EntryCategory,
): SchedulePalette | null {
  if (accent) return SCHEDULE_ACCENT_PALETTES[accent];
  if (category === "vacation") return VACATION_SCHEDULE_PALETTE;
  if (category === "business_trip") return BUSINESS_TRIP_SCHEDULE_PALETTE;
  return null;
}

export interface CategoryPalette {
  readonly bg: string;
  readonly fg: string;
}

// Chip background/foreground pairs, tuned separately per theme so every
// category stays legible on both a near-white and a near-black canvas.
export const CATEGORY_PALETTES_LIGHT: Record<EntryCategory, CategoryPalette> = {
  shift: { bg: "#E3EFFC", fg: "#144F8F" }, // Telegram blue
  vacation: { bg: "#FCEEDA", fg: "#714700" }, // amber
  sick_leave: { bg: "#FCE4E4", fg: "#931F19" }, // rose
  duty: { bg: "#DEF5F0", fg: "#095A51" }, // teal
  offsite: { bg: "#EEE6FB", fg: "#622CAC" }, // violet
  business_trip: { bg: "#E4E6FA", fg: "#373FA6" }, // indigo
  weekend_work: { bg: "#E1F6E1", fg: "#185D28" }, // green
};

export const CATEGORY_PALETTES_DARK: Record<EntryCategory, CategoryPalette> = {
  shift: { bg: "rgba(64,150,238,0.24)", fg: "#8EC9FF" },
  vacation: { bg: "rgba(240,170,60,0.22)", fg: "#F4C169" },
  sick_leave: { bg: "rgba(230,80,60,0.24)", fg: "#F5A296" },
  duty: { bg: "rgba(48,191,171,0.22)", fg: "#5FE0CB" },
  offsite: { bg: "rgba(160,110,235,0.24)", fg: "#C4A4F5" },
  business_trip: { bg: "rgba(102,112,225,0.24)", fg: "#AEB4F7" },
  weekend_work: { bg: "rgba(70,190,90,0.22)", fg: "#86E093" },
};

/**
 * Цвет записи для конкретной темы: точный цвет пресета, если он есть, иначе
 * цвет категории. Картинка бота зовёт это со `isDark: false` — у PNG нет темы,
 * а светлый вариант читается и в тёмном чате.
 */
export function categoryPalette(category: EntryCategory, isDark: boolean): CategoryPalette {
  const exact = exactSchedulePalette(undefined, category);
  if (exact) return { bg: exact.bg, fg: exact.fg };
  return (isDark ? CATEGORY_PALETTES_DARK : CATEGORY_PALETTES_LIGHT)[category];
}
