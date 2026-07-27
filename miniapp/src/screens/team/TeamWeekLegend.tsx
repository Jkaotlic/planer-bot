import { categoryPaletteForTheme } from "../../categories";
import type { WeekLegendItem } from "../../lib/team-schedule";

/**
 * The key under the week grid. Each row is the very square the grid draws — same
 * letter, same colour — next to what it means, so «П» stops being a guess.
 *
 * It lists only what this week actually contains, so a quiet week shows three
 * lines instead of all nine presets.
 */
export function TeamWeekLegend({ items, isDark }: { items: readonly WeekLegendItem[]; isDark: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="team-legend">
      <div className="team-legend__title">Что значат буквы</div>
      <ul className="team-legend__list">
        {items.map((item) => {
          // Presetless entries take their colour from the category, and that colour
          // is theme-dependent — resolved here exactly as TeamWeekGrid resolves it.
          const palette = item.palette ?? categoryPaletteForTheme(item.category ?? "shift", isDark);
          return (
            <li className="team-legend__item" key={`${item.code}:${item.label}`}>
              <span className="team-legend__code" style={{ background: palette.bg, color: palette.fg }} aria-hidden="true">
                {item.code}
              </span>
              <span className="team-legend__label">{item.label}</span>
            </li>
          );
        })}
      </ul>
      <p className="team-legend__hint">Нажми на клетку — покажет, кто и во сколько.</p>
    </div>
  );
}
