import type { CSSProperties, ReactNode } from "react";
import { Chip } from "@telegram-apps/telegram-ui";
import { exactSchedulePalette, UNRECOGNISED_SCHEDULE_PALETTE, type EntryCategory, type TemplateAccent } from "@planer/shared";
import { useIsDark } from "./lib/theme";

export type { EntryCategory as Category, TemplateAccent } from "@planer/shared";
type Category = EntryCategory;

const CATEGORY_LABELS: Record<Category, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  duty: "Дежурство",
  offsite: "Выездное мероприятие",
  business_trip: "Командировка",
  weekend_work: "Работа в выходной",
};

export function categoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}

export interface CategoryPalette {
  readonly bg: string;
  readonly fg: string;
}

// Chip background/foreground pairs, tuned separately per theme so every
// category stays legible on both a near-white and a near-black canvas.
const LIGHT_PALETTE: Record<Category, CategoryPalette> = {
  shift: { bg: "#E3EFFC", fg: "#144F8F" }, // Telegram blue
  vacation: { bg: "#FCEEDA", fg: "#714700" }, // amber
  sick_leave: { bg: "#FCE4E4", fg: "#931F19" }, // rose
  duty: { bg: "#DEF5F0", fg: "#095A51" }, // teal
  offsite: { bg: "#EEE6FB", fg: "#622CAC" }, // violet
  business_trip: { bg: "#E4E6FA", fg: "#373FA6" }, // indigo
  weekend_work: { bg: "#E1F6E1", fg: "#185D28" }, // green
};

const DARK_PALETTE: Record<Category, CategoryPalette> = {
  shift: { bg: "rgba(64,150,238,0.24)", fg: "#8EC9FF" },
  vacation: { bg: "rgba(240,170,60,0.22)", fg: "#F4C169" },
  sick_leave: { bg: "rgba(230,80,60,0.24)", fg: "#F5A296" },
  duty: { bg: "rgba(48,191,171,0.22)", fg: "#5FE0CB" },
  offsite: { bg: "rgba(160,110,235,0.24)", fg: "#C4A4F5" },
  business_trip: { bg: "rgba(102,112,225,0.24)", fg: "#AEB4F7" },
  weekend_work: { bg: "rgba(70,190,90,0.22)", fg: "#86E093" },
};

/** Resolves the existing category colour for an explicit Telegram appearance. */
export function categoryPaletteForTheme(
  category: Category,
  isDark: boolean,
): CategoryPalette {
  const exact = exactSchedulePalette(undefined, category);
  if (exact) return { bg: exact.bg, fg: exact.fg };
  return (isDark ? DARK_PALETTE : LIGHT_PALETTE)[category];
}

/** Minimal shape needed to colour an entry — avoids importing the api types here. */
interface ColourableEntry {
  category: Category;
  templateId: number | null;
  /** Set only on a cell the import could not read — it wins over every other colour. */
  unrecognisedCode?: string | null;
}
interface AccentedTemplate {
  id: number;
  accent: TemplateAccent;
}

/**
 * Colours for one schedule entry: the accent of the preset it came from, falling
 * back to its category's colour when it has no preset (custom times, absences).
 */
export function useEntryPalette(entry: ColourableEntry, templates: readonly AccentedTemplate[]): CategoryPalette {
  const isDark = useIsDark();
  // An unread cell is not a kind of shift — it is «мы не поняли файл», and it keeps
  // its own grey whatever category it was filed under.
  if (entry.unrecognisedCode) return { bg: UNRECOGNISED_SCHEDULE_PALETTE.bg, fg: UNRECOGNISED_SCHEDULE_PALETTE.fg };
  const accent = entry.templateId != null ? templates.find((t) => t.id === entry.templateId)?.accent : undefined;
  const exact = exactSchedulePalette(accent, entry.category);
  if (exact) return { bg: exact.bg, fg: exact.fg };
  return (isDark ? DARK_PALETTE : LIGHT_PALETTE)[entry.category];
}

/** The category's chip colors for the currently active Telegram theme. */
export function useCategoryPalette(category: Category): CategoryPalette {
  const isDark = useIsDark();
  return categoryPaletteForTheme(category, isDark);
}

export interface CategoryChipProps {
  category: Category;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * `Chip`'s inner text is a `Subheadline` that sets its own explicit
 * `color: var(--tgui--plain_foreground)` — more specific than a `color`
 * inherited from this wrapper, so a plain inline `color` here would be
 * silently ignored. Overriding the CSS variable itself (which the
 * `Subheadline` reads via `var()`) is what actually recolors the text.
 */
interface ChipStyle extends CSSProperties {
  "--tgui--plain_foreground"?: string;
}

/** Small color-coded pill labelling a shift's category. Legible in light and dark. */
export function CategoryChip({ category, className, style, children }: CategoryChipProps) {
  const palette = useCategoryPalette(category);
  const chipStyle: ChipStyle = {
    background: palette.bg,
    "--tgui--plain_foreground": palette.fg,
    fontWeight: 500,
    ...style,
  };
  return (
    <Chip mode="mono" className={className} style={chipStyle}>
      {children ?? categoryLabel(category)}
    </Chip>
  );
}
