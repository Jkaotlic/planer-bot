import { addDaysIso, buildWeekLegend, buildWeekModel, formatWeekRangeLabelIso } from "@planer/shared";
import type { Db } from "../db/client";
import { readTeamSchedule } from "../repo/team-schedule";
import { listActiveTemplates } from "../repo/templates";
import { renderWeekSvg } from "../render/week-svg";
import { svgToPng } from "../render/rasterize";

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

export function buildWeekImage(db: Db, mondayIso: string, today: string): WeekImage {
  const sunday = addDaysIso(mondayIso, 6);
  const schedule = readTeamSchedule(db, mondayIso, sunday);
  if (schedule.employees.length === 0) return { kind: "text", text: "В расписании пока никого." };

  const model = buildWeekModel(mondayIso, schedule, listActiveTemplates(db));
  const label = `Команда · ${formatWeekRangeLabelIso(mondayIso, sunday)}`;
  const svg = renderWeekSvg({ model, legend: buildWeekLegend(model), weekLabel: label, today });
  return { kind: "photo", png: svgToPng(svg), caption: label };
}
