import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type TeamSchedule, type Template } from "../api/client";
import { calendarFrom } from "@planer/shared";
import { useIsDark } from "../lib/theme";
import { Screen } from "../ui";
import {
  applyTeamScreenLoadResult,
  beginTeamScreenLoad,
  buildTodayModel,
  buildWeekLegend,
  buildWeekModel,
  createLatestRequestGate,
  createTeamScreenState,
  moveTeamDate,
  requestLatestTeamSchedule,
  teamModeLoadTarget,
  teamRange,
  teamTabFocusMode,
  teamVisibilityRefreshTarget,
  type TeamMode,
  type TeamScreenState,
} from "../lib/team-schedule";
import {
  formatDayLabelRelative,
  formatWeekRangeLabel,
  isCurrentPeriod,
  parseISODate,
} from "../lib/week";
import { TeamRangeNav } from "./team/TeamRangeNav";
import { TeamTodayView } from "./team/TeamTodayView";
import { TeamViewPanel, TeamViewSwitcher } from "./team/TeamViewSwitcher";
import { TeamWeekGrid } from "./team/TeamWeekGrid";
import { TeamWeekLegend } from "./team/TeamWeekLegend";
import "./team/team-schedule.css";

/** `initialMode` — личная настройка «открывать сразу»: тому, кто ведёт график,
 *  нужна неделя, и до сих пор её приходилось выбирать руками при каждом входе.
 *  Внутри экрана вид по-прежнему переключается свободно.
 *
 *  `today` — командная дата с сервера (`myShifts.today` из bootstrap), не часы
 *  телефона: рядом с полуночью они расходятся, и раньше «Сегодня» здесь
 *  показывало день телефона, а не тот, что команда считает сегодняшним. */
export function TeamScreen({ templates, initialMode = "today", today, meId }: { templates: readonly Template[]; initialMode?: TeamMode; today: string; meId?: number }) {
  const [view, setView] = useState(() => createTeamScreenState(today, initialMode));
  const [tabFocusMode, setTabFocusMode] = useState<TeamMode>(view.displayMode);
  const viewRef = useRef(view);
  const gate = useRef(createLatestRequestGate());
  const isDark = useIsDark();

  const commitView = useCallback((next: TeamScreenState) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const load = useCallback(async (targetMode: TeamMode, targetDate: string) => {
    commitView(beginTeamScreenLoad(viewRef.current, targetMode, targetDate));
    const result = await requestLatestTeamSchedule(
      apiClient.getTeamSchedule,
      teamRange(targetMode, targetDate),
      gate.current,
    );
    const next = applyTeamScreenLoadResult(
      viewRef.current,
      targetMode,
      targetDate,
      result,
    );
    if (next) commitView(next);
  }, [commitView]);

  useEffect(() => {
    const current = viewRef.current;
    void load(current.targetMode, current.targetDate);
    return () => gate.current.invalidate();
  }, [load]);

  useEffect(() => {
    if (!view.loading) setTabFocusMode(view.displayMode);
  }, [view.displayMode, view.loading]);

  useEffect(() => {
    function onVisible() {
      const current = viewRef.current;
      if (document.visibilityState === "visible") {
        const target = teamVisibilityRefreshTarget(current);
        if (target) void load(target.mode, target.date);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  function move(direction: -1 | 1) {
    const current = viewRef.current;
    if (current.loading) return;
    const targetDate = moveTeamDate(
      current.displayMode,
      current.displayDate,
      direction,
    );
    void load(current.displayMode, targetDate);
  }

  function changeMode(mode: TeamMode): boolean {
    const current = viewRef.current;
    const target = teamModeLoadTarget(current, mode);
    if (!target) return false;
    setTabFocusMode(mode);
    void load(target.mode, target.date);
    return true;
  }

  const displayRange = teamRange(view.displayMode, view.displayDate);
  const isDayMode = view.displayMode === "today";
  const label = isDayMode
    ? formatDayLabelRelative(view.displayDate, today)
    : formatWeekRangeLabel(
        parseISODate(displayRange.from),
        parseISODate(displayRange.to),
      );

  return (
    <Screen title="Команда">
      <div className="team-screen">
        <TeamViewSwitcher
          value={view.displayMode}
          focusValue={teamTabFocusMode(view, tabFocusMode)}
          onChange={changeMode}
        />
        <TeamRangeNav
          label={label}
          busy={view.loading}
          backLabel={isDayMode ? "Сегодня" : "Эта неделя"}
          onBack={
            isCurrentPeriod(isDayMode ? "day" : "week", view.displayDate, today)
              ? undefined
              : () => { if (!view.loading) void load(view.displayMode, today); }
          }
          onPrevious={() => move(-1)}
          onNext={() => move(1)}
        />
        {view.loading && (
          <div className="team-refreshing" role="status">
            Обновляем…
          </div>
        )}
        {view.error && (
          <div className="team-error" role="alert">
            <span>{view.error}</span>
            <button
              type="button"
              onClick={() => void load(view.targetMode, view.targetDate)}
            >
              Повторить
            </button>
          </div>
        )}
        <TeamViewPanel mode={view.displayMode}>
          {!view.schedule && view.loading && <Spinner size="m" />}
          {view.schedule && view.displayMode === "today" && (
            <TeamTodayView
              model={buildTodayModel(view.displayDate, view.schedule, templates)}
              isDark={isDark}
            />
          )}
          {view.schedule && view.displayMode === "week" && (
            <WeekView schedule={view.schedule} from={displayRange.from} templates={templates} isDark={isDark} today={today} meId={meId} />
          )}
        </TeamViewPanel>
      </div>
    </Screen>
  );
}

/** The week grid plus its key. Built once so both read the same model. */
function WeekView({
  schedule,
  from,
  templates,
  isDark,
  today,
  meId,
}: {
  schedule: TeamSchedule;
  meId?: number;
  from: string;
  templates: readonly Template[];
  isDark: boolean;
  /** Passed down from `TeamScreen` rather than read here again — one `toISODate(new
   *  Date())` per render, so the header and the grid can never disagree about
   *  which day is "today" (e.g. right at the midnight boundary). */
  today: string;
}) {
  const model = buildWeekModel(from, schedule, templates);
  return (
    <>
      <TeamWeekGrid model={model} today={today} isDark={isDark} calendar={calendarFrom(schedule.calendar)} meId={meId} />
      <TeamWeekLegend items={buildWeekLegend(model)} isDark={isDark} />
    </>
  );
}
