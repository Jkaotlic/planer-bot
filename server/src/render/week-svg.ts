import {
  categoryPalette,
  isWeekend,
  splitDisplayName,
  weekdayShort,
  type ScheduleEntryLike,
  type WeekLegendItem,
  type WeekModel,
} from "@planer/shared";

/**
 * The «team × week» grid as an SVG string — what the bot sends for /week.
 *
 * Pure function: takes a ready-made model, returns a string. No filesystem, no
 * fonts, no rasterisation — that all happens later, in rasterize.ts. That way
 * the whole layout is tested with ordinary tests, without a single binary.
 *
 * One theme, light only: a PNG has no theme, and the light variant still reads
 * fine inside a dark chat.
 */

export const WEEK_SVG_WIDTH = 1200;

const PAD = 16;
const TITLE_H = 44;
const NAME_COL = 244;
const DAY_COL = 132;
const HEADER_H = 64;
const ROW_H = 56;
const LEGEND_TITLE_H = 32;
const LEGEND_ROW_H = 40;
const MAX_SURNAME_CHARS = 16;
const MAX_GIVEN_CHARS = 12;
const MAX_LEGEND_CHARS = 40;

const INK = {
  canvas: "#FFFFFF",
  grid: "#D9DEE6",
  header: "#F2F5F9",
  weekend: "#E9EEF5",
  today: "#2F80ED",
  text: "#17202A",
  muted: "#6B7280",
} as const;

export interface WeekSvgInput {
  model: WeekModel<ScheduleEntryLike>;
  legend: readonly WeekLegendItem[];
  /** Title drawn inside the image, e.g. «Команда · 3–9 августа». */
  weekLabel: string;
  /** Today in TEAM_TZ; if that day falls inside the week, its column is outlined. */
  today: string;
}

/**
 * Escaping is mandatory: one surname with an ampersand would otherwise make
 * the document invalid, and the image would fail to render for everyone.
 *
 * Control characters are dropped rather than escaped, because XML forbids them
 * outright — `&#1;` is just as invalid as the raw byte. One of them anywhere in
 * a name or a preset's title kills the whole picture for the whole team, with a
 * parser message that names no row. They reach us in real life: input is only
 * `.trim()`-ed, and the roster import reads CSV exported from Excel.
 */
export function escapeXml(value: string): string {
  return value
    // Everything in C0 except the three XML allows: tab, LF, CR.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** SVG has no `text-overflow`, so we clip by character count ourselves. */
function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function renderWeekSvg({ model, legend, weekLabel, today }: WeekSvgInput): string {
  const gridTop = PAD + TITLE_H;
  const bodyTop = gridTop + HEADER_H;
  const bodyHeight = model.rows.length * ROW_H;
  const legendBlock = LEGEND_TITLE_H
    + (legend.length > 0 ? Math.ceil(legend.length / 2) * LEGEND_ROW_H : LEGEND_ROW_H);
  const height = bodyTop + bodyHeight + legendBlock + PAD;
  const dayX = (index: number) => PAD + NAME_COL + index * DAY_COL;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WEEK_SVG_WIDTH}" height="${height}"`
      + ` viewBox="0 0 ${WEEK_SVG_WIDTH} ${height}" font-family="DejaVu Sans">`,
  );
  out.push(`<rect width="${WEEK_SVG_WIDTH}" height="${height}" fill="${INK.canvas}"/>`);

  // Title inside the image, not only in the message caption: a forwarded photo
  // loses its caption, and without this there is no way to tell which week it is.
  out.push(
    `<text x="${PAD}" y="${PAD + 30}" font-size="26" font-weight="bold" fill="${INK.text}">`
      + `${escapeXml(weekLabel)}</text>`,
  );

  // Header and weekend column fills — before the rows, so the cells lay on top.
  out.push(`<rect x="${PAD}" y="${gridTop}" width="${WEEK_SVG_WIDTH - 2 * PAD}" height="${HEADER_H}" fill="${INK.header}"/>`);
  model.days.forEach((day, index) => {
    const x = dayX(index);
    if (isWeekend(day)) {
      out.push(`<rect x="${x}" y="${gridTop}" width="${DAY_COL}" height="${HEADER_H + bodyHeight}" fill="${INK.weekend}"/>`);
    }
    const centre = x + DAY_COL / 2;
    out.push(
      `<text x="${centre}" y="${gridTop + 26}" font-size="20" font-weight="bold"`
        + ` text-anchor="middle" fill="${INK.text}">${escapeXml(weekdayShort(day))}</text>`,
    );
    out.push(
      `<text x="${centre}" y="${gridTop + 50}" font-size="18" text-anchor="middle"`
        + ` fill="${INK.muted}">${Number(day.slice(8, 10))}</text>`,
    );
  });

  model.rows.forEach((row, rowIndex) => {
    const y = bodyTop + rowIndex * ROW_H;
    const name = splitDisplayName(row.displayName);
    out.push(
      `<text x="${PAD + 8}" y="${y + 34}" font-size="19" font-weight="bold" fill="${INK.text}">`
        + `${escapeXml(clip(name.surname, MAX_SURNAME_CHARS))}</text>`,
    );
    if (name.rest) {
      out.push(
        `<text x="${PAD + NAME_COL - 8}" y="${y + 34}" font-size="16" text-anchor="end"`
          + ` fill="${INK.muted}">${escapeXml(clip(name.rest, MAX_GIVEN_CHARS))}</text>`,
      );
    }
    row.cells.forEach((cell, dayIndex) => {
      const entry = cell.primary;
      if (!entry) return;
      const x = dayX(dayIndex);
      const palette = entry.palette ?? categoryPalette(entry.shift.category, false);
      out.push(
        `<rect x="${x + 4}" y="${y + 4}" width="${DAY_COL - 8}" height="${ROW_H - 8}" rx="8" fill="${palette.bg}"/>`,
      );
      out.push(
        `<text x="${x + DAY_COL / 2}" y="${y + ROW_H / 2 + 8}" font-size="22" font-weight="bold"`
          + ` text-anchor="middle" fill="${palette.fg}">${escapeXml(entry.palette?.code ?? "•")}</text>`,
      );
      if (cell.extraCount > 0) {
        out.push(
          `<text x="${x + DAY_COL - 12}" y="${y + 22}" font-size="14" text-anchor="end"`
            + ` fill="${palette.fg}">+${cell.extraCount}</text>`,
        );
      }
    });
    out.push(
      `<line x1="${PAD}" y1="${y + ROW_H}" x2="${WEEK_SVG_WIDTH - PAD}" y2="${y + ROW_H}"`
        + ` stroke="${INK.grid}" stroke-width="1"/>`,
    );
  });

  // Today's column outline — drawn after the rows, on top of everything, or the
  // cell fills would eat it.
  const todayIndex = model.days.indexOf(today);
  if (todayIndex >= 0) {
    out.push(
      `<rect x="${dayX(todayIndex)}" y="${gridTop}" width="${DAY_COL}" height="${HEADER_H + bodyHeight}"`
        + ` fill="none" rx="6" stroke="${INK.today}" stroke-width="3"/>`,
    );
  }

  const legendTop = bodyTop + bodyHeight + LEGEND_TITLE_H;
  if (legend.length === 0) {
    out.push(
      `<text x="${PAD}" y="${legendTop + 8}" font-size="18" fill="${INK.muted}">`
        + `На этой неделе записей нет</text>`,
    );
  } else {
    out.push(
      `<text x="${PAD}" y="${bodyTop + bodyHeight + 26}" font-size="16" font-weight="bold"`
        + ` fill="${INK.muted}">Что значат буквы</text>`,
    );
    const columnWidth = (WEEK_SVG_WIDTH - 2 * PAD) / 2;
    legend.forEach((item, index) => {
      const x = PAD + (index % 2) * columnWidth;
      const y = legendTop + Math.floor(index / 2) * LEGEND_ROW_H;
      const palette = item.palette ?? categoryPalette(item.category ?? "shift", false);
      out.push(`<rect x="${x}" y="${y}" width="34" height="28" rx="6" fill="${palette.bg}"/>`);
      out.push(
        `<text x="${x + 17}" y="${y + 20}" font-size="16" font-weight="bold" text-anchor="middle"`
          + ` fill="${palette.fg}">${escapeXml(item.code)}</text>`,
      );
      out.push(
        `<text x="${x + 44}" y="${y + 20}" font-size="17" fill="${INK.text}">`
          + `${escapeXml(clip(item.label, MAX_LEGEND_CHARS))}</text>`,
      );
    });
  }

  out.push("</svg>");
  return out.join("");
}
