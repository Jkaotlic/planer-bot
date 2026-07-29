import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner, Title } from "@telegram-apps/telegram-ui";
import { apiClient, type TeamSchedule, type Template } from "../api/client";
import { useIsDark } from "../lib/theme";
import { ScreenScroll, TAB_BAR_CLEARANCE } from "../components/ScreenScroll";
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
  toISODate,
} from "../lib/week";
import { TeamRangeNav } from "./team/TeamRangeNav";
import { TeamTodayView } from "./team/TeamTodayView";
import { TeamViewPanel, TeamViewSwitcher } from "./team/TeamViewSwitcher";
import { TeamWeekGrid } from "./team/TeamWeekGrid";
import { TeamWeekLegend } from "./team/TeamWeekLegend";
import "./team/team-schedule.css";

export function TeamScreen({ templates }: { templates: readonly Template[] }) {
  const [view, setView] = useState(() => createTeamScreenState(toISODate(new Date())));
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
  const today = toISODate(new Date());
  const label =
    view.displayMode === "today"
      ? formatDayLabelRelative(view.displayDate, today)
      : formatWeekRangeLabel(
          parseISODate(displayRange.from),
          parseISODate(displayRange.to),
        );

  // 16px on top, not 8: at 8 the «Команда» title sat flush against the very edge
  // of the screen, and in the real client Telegram's own header is right above it.
  return (
    <ScreenScroll style={{ padding: `16px 12px ${TAB_BAR_CLEARANCE}` }}>
      <div className="team-screen">
        <Title level="2" weight="2">
          Команда
        </Title>
        <TeamViewSwitcher
          value={view.displayMode}
          focusValue={teamTabFocusMode(view, tabFocusMode)}
          onChange={changeMode}
        />
        <TeamRangeNav
          label={label}
          busy={view.loading}
          backLabel={view.displayMode === "today" ? "Сегодня" : "Эта неделя"}
          onBack={
            isCurrentPeriod(view.displayMode === "today" ? "day" : "week", view.displayDate, today)
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
            <WeekView schedule={view.schedule} from={displayRange.from} templates={templates} isDark={isDark} today={today} />
          )}
        </TeamViewPanel>
      </div>
    </ScreenScroll>
  );
}

/** The week grid plus its key. Built once so both read the same model. */
function WeekView({
  schedule,
  from,
  templates,
  isDark,
  today,
}: {
  schedule: TeamSchedule;
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
      <TeamWeekGrid model={model} today={today} isDark={isDark} />
      <TeamWeekLegend items={buildWeekLegend(model)} isDark={isDark} />
    </>
  );
}
