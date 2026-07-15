import type { CSSProperties, ReactNode } from "react";
import { Chip } from "@telegram-apps/telegram-ui";
import { useIsDark } from "./lib/theme";

/** Mirrors the backend's `TemplateAccent` (see `shared/src/category.ts`). */
export type TemplateAccent = "gold" | "blue" | "violet" | "indigo" | "teal" | "green" | "rose";

/** Mirrors the backend's `EntryCategory` (see `shared/src/category.ts`). */
export type Category = "shift" | "vacation" | "sick_leave" | "duty" | "offsite" | "business_trip" | "weekend_work";

const CATEGORY_LABELS: Record<Category, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  duty: "Дежурство",
  offsite: "Выезд",
  business_trip: "Командировка",
  weekend_work: "Работа в выходной",
};

export function categoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}

interface CategoryPalette {
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


// Per-preset accents. A preset's colour wins over its category's, so Утро/День/
// Вечер/Ночь read apart in the schedule instead of sharing one blue; entries with
// no preset still fall back to the category colour below.
const LIGHT_ACCENTS: Record<TemplateAccent, CategoryPalette> = {
  gold: { bg: "#FBF1CF", fg: "#684D00" },
  blue: { bg: "#E3EFFC", fg: "#144F8F" },
  violet: { bg: "#EEE6FB", fg: "#622CAC" },
  indigo: { bg: "#DFE3F8", fg: "#2F3A9E" },
  teal: { bg: "#DEF5F0", fg: "#095A51" },
  green: { bg: "#E1F6E1", fg: "#185D28" },
  rose: { bg: "#FCE4E4", fg: "#931F19" },
};

const DARK_ACCENTS: Record<TemplateAccent, CategoryPalette> = {
  gold: { bg: "rgba(235,190,70,0.22)", fg: "#F0CE79" },
  blue: { bg: "rgba(64,150,238,0.24)", fg: "#8EC9FF" },
  violet: { bg: "rgba(160,110,235,0.24)", fg: "#C4A4F5" },
  indigo: { bg: "rgba(92,104,220,0.28)", fg: "#A6AEF7" },
  teal: { bg: "rgba(48,191,171,0.22)", fg: "#5FE0CB" },
  green: { bg: "rgba(70,190,90,0.22)", fg: "#86E093" },
  rose: { bg: "rgba(230,80,60,0.24)", fg: "#F5A296" },
};

/** Minimal shape needed to colour an entry — avoids importing the api types here. */
interface ColourableEntry {
  category: Category;
  templateId: number | null;
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
  const accent = entry.templateId != null ? templates.find((t) => t.id === entry.templateId)?.accent : undefined;
  if (accent) return (isDark ? DARK_ACCENTS : LIGHT_ACCENTS)[accent];
  return (isDark ? DARK_PALETTE : LIGHT_PALETTE)[entry.category];
}

/** The category's chip colors for the currently active Telegram theme. */
export function useCategoryPalette(category: Category): CategoryPalette {
  const isDark = useIsDark();
  return (isDark ? DARK_PALETTE : LIGHT_PALETTE)[category];
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
