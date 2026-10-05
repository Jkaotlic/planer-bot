import { addDaysIso, buildWeekLegend, buildWeekModel, formatWeekRangeLabelIso } from "@planer/shared";
import type { Db } from "../db/client";
import { readTeamSchedule, type TeamScheduleView } from "../repo/team-schedule";
import { loadCalendar } from "../repo/calendar-days";
import { listActiveTemplates } from "../repo/templates";
import { renderWeekSvg } from "../render/week-svg";
import { svgToPng } from "../render/rasterize";

/**
 * The week the image draws: the team schedule minus «ждёт ОК». A PNG has no dashed
 * border to tell a pending sick leave apart, and a legend line for a square nobody can
 * see would explain nothing — the grid screens carry that state, the image does not.
 */
export function scheduleForImage(db: Db, mondayIso: string): TeamScheduleView {
  const schedule = readTeamSchedule(db, mondayIso, addDaysIso(mondayIso, 6));
  return { ...schedule, shifts: schedule.shifts.map(({ pending: _pending, ...shift }) => shift) };
}

/**
 * Week image for the bot: schedule → model → SVG → PNG.
 *
 * The text variant is not a fallback render but an honest answer for the case
 * when there's nothing to draw: a grid with zero rows is not a picture, it's
 * a mistake.
 */
export type WeekImage =
  | { kind: "photo"; png: Buffer; caption: string }
  | { kind: "text"; text: string };

export function buildWeekImage(db: Db, mondayIso: string, today: string, showLegend = true): WeekImage {
  const sunday = addDaysIso(mondayIso, 6);
  const schedule = scheduleForImage(db, mondayIso);
  if (schedule.employees.length === 0) return { kind: "text", text: "В расписании пока никого." };

  const model = buildWeekModel(mondayIso, schedule, listActiveTemplates(db));
  const label = `Команда · ${formatWeekRangeLabelIso(mondayIso, sunday)}`;
  const svg = renderWeekSvg({
    model,
    legend: buildWeekLegend(model),
    weekLabel: label,
    today,
    calendar: loadCalendar(db, mondayIso, sunday),
    showLegend,
  });
  return { kind: "photo", png: svgToPng(svg), caption: label };
}
