import type { CSSProperties, ReactNode } from "react";
import {
  categoryPalette,
  exactSchedulePalette,
  UNRECOGNISED_SCHEDULE_PALETTE,
  type CategoryPalette,
  type EntryCategory,
  type TemplateAccent,
} from "@planer/shared";
import { useIsDark } from "./lib/theme";

const CATEGORY_LABELS: Record<EntryCategory, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  duty: "Дежурство",
  offsite: "Мероприятие",
  business_trip: "Командировка",
  weekend_work: "Работа в выходной",
};

export function categoryLabel(category: EntryCategory): string {
  return CATEGORY_LABELS[category];
}

/** Minimal shape needed to colour an entry — avoids importing the api types here. */
interface ColourableEntry {
  category: EntryCategory;
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
  return categoryPalette(entry.category, isDark);
}

/** The category's chip colors for the currently active Telegram theme. */
export function useCategoryPalette(category: EntryCategory): CategoryPalette {
  const isDark = useIsDark();
  return categoryPalette(category, isDark);
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
