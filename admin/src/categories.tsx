import type { CSSProperties, ReactNode } from "react";
import type { EntryCategory } from "@planer/shared";
import { useIsDark } from "./lib/theme";

export type { EntryCategory as Category } from "@planer/shared";

const CATEGORY_LABELS: Record<EntryCategory, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  duty: "Дежурство",
  offsite: "Выездное",
  business_trip: "Командировка",
  weekend_work: "Выходной",
};

export function categoryLabel(category: EntryCategory): string {
  return CATEGORY_LABELS[category];
}

/** All categories a new entry can be created with, in the order the add-panel offers them. */
export const ALL_CATEGORIES: readonly EntryCategory[] = [
  "shift",
  "vacation",
  "duty",
  "offsite",
  "business_trip",
  "weekend_work",
];

interface CategoryPalette {
  readonly bg: string;
  readonly fg: string;
}

// Chip background/foreground pairs, tuned separately per theme so every
// category stays legible on both a near-white and a near-black canvas.
// Mirrors miniapp/src/categories.tsx so the two apps read consistently.
const LIGHT_PALETTE: Record<EntryCategory, CategoryPalette> = {
  shift: { bg: "#E3EFFC", fg: "#1C6FC9" }, // Telegram blue
  vacation: { bg: "#FCEEDA", fg: "#8A5700" }, // amber
  duty: { bg: "#DEF5F0", fg: "#0C7A6E" }, // teal
  offsite: { bg: "#EEE6FB", fg: "#7132C6" }, // violet
  business_trip: { bg: "#E4E6FA", fg: "#3D46B8" }, // indigo
  weekend_work: { bg: "#E1F6E1", fg: "#1F7A34" }, // green
};

const DARK_PALETTE: Record<EntryCategory, CategoryPalette> = {
  shift: { bg: "rgba(64,150,238,0.24)", fg: "#8EC9FF" },
  vacation: { bg: "rgba(240,170,60,0.22)", fg: "#F4C169" },
  duty: { bg: "rgba(48,191,171,0.22)", fg: "#5FE0CB" },
  offsite: { bg: "rgba(160,110,235,0.24)", fg: "#C4A4F5" },
  business_trip: { bg: "rgba(102,112,225,0.24)", fg: "#AEB4F7" },
  weekend_work: { bg: "rgba(70,190,90,0.22)", fg: "#86E093" },
};

/** The category's chip colors for the currently active Telegram theme. */
export function useCategoryPalette(category: EntryCategory): CategoryPalette {
  const isDark = useIsDark();
  return (isDark ? DARK_PALETTE : LIGHT_PALETTE)[category];
}

export interface CategoryChipProps {
  category: EntryCategory;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Small color-coded pill labelling an entry's category. Legible in light and dark. */
export function CategoryChip({ category, className, style, children }: CategoryChipProps) {
  const palette = useCategoryPalette(category);
  const chipStyle: CSSProperties = {
    background: palette.bg,
    color: palette.fg,
    ...style,
  };
  return (
    <span className={`category-chip${className ? ` ${className}` : ""}`} style={chipStyle}>
      {children ?? categoryLabel(category)}
    </span>
  );
}
