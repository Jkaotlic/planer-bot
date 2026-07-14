import type { CSSProperties, ReactNode } from "react";
import { Chip } from "@telegram-apps/telegram-ui";
import { useIsDark } from "./lib/theme";

/** Mirrors the backend's `EntryCategory` (see `shared/src/category.ts`). */
export type Category = "shift" | "vacation" | "duty" | "offsite" | "business_trip" | "weekend_work";

const CATEGORY_LABELS: Record<Category, string> = {
  shift: "Смена",
  vacation: "Отпуск",
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
  shift: { bg: "#E3EFFC", fg: "#1C6FC9" }, // Telegram blue
  vacation: { bg: "#FCEEDA", fg: "#8A5700" }, // amber
  duty: { bg: "#DEF5F0", fg: "#0C7A6E" }, // teal
  offsite: { bg: "#EEE6FB", fg: "#7132C6" }, // violet
  business_trip: { bg: "#E4E6FA", fg: "#3D46B8" }, // indigo
  weekend_work: { bg: "#E1F6E1", fg: "#1F7A34" }, // green
};

const DARK_PALETTE: Record<Category, CategoryPalette> = {
  shift: { bg: "rgba(64,150,238,0.24)", fg: "#8EC9FF" },
  vacation: { bg: "rgba(240,170,60,0.22)", fg: "#F4C169" },
  duty: { bg: "rgba(48,191,171,0.22)", fg: "#5FE0CB" },
  offsite: { bg: "rgba(160,110,235,0.24)", fg: "#C4A4F5" },
  business_trip: { bg: "rgba(102,112,225,0.24)", fg: "#AEB4F7" },
  weekend_work: { bg: "rgba(70,190,90,0.22)", fg: "#86E093" },
};

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
