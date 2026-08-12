import type { CSSProperties, ReactNode } from "react";
import { Chip } from "@telegram-apps/telegram-ui";
import {
  categoryPalette,
  exactSchedulePalette,
  UNRECOGNISED_SCHEDULE_PALETTE,
  type CategoryPalette,
  type EntryCategory,
  type TemplateAccent,
} from "@planer/shared";
import { useIsDark } from "./lib/theme";

export type { EntryCategory as Category, TemplateAccent } from "@planer/shared";
type Category = EntryCategory;

const CATEGORY_LABELS: Record<Category, string> = {
  shift: "Смена",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  duty: "Дежурство",
  offsite: "Мероприятие",
  business_trip: "Командировка",
  weekend_work: "Работа в выходной",
};

export function categoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}

export type { CategoryPalette };

/**
 * Resolves the existing category colour for an explicit Telegram appearance.
 *
 * Таблица переехала в @planer/shared: теми же цветами сервер красит клетки
 * картинки недели для бота, и разъезжаться копии не должны.
 */
export function categoryPaletteForTheme(category: Category, isDark: boolean): CategoryPalette {
  return categoryPalette(category, isDark);
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
  return categoryPalette(entry.category, isDark);
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
