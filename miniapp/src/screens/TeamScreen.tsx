import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner, Title } from "@telegram-apps/telegram-ui";
import { apiClient, type Template } from "../api/client";
import { ScreenScroll, TAB_BAR_CLEARANCE } from "../components/ScreenScroll";
import {
  applyTeamScreenLoadResult,
  beginTeamScreenLoad,
  buildTodayModel,
  createLatestRequestGate,
  createTeamScreenState,
  requestLatestTeamSchedule,
  teamRange,
  type TeamScreenState,
} from "../lib/team-schedule";
import { addDays, formatDayLabel, parseISODate, toISODate } from "../lib/week";
import { TeamRangeNav } from "./team/TeamRangeNav";
import { TeamTodayView } from "./team/TeamTodayView";
import "./team/team-schedule.css";

export function TeamScreen({ templates }: { templates: readonly Template[] }) {
  const [view, setView] = useState(() => createTeamScreenState(toISODate(new Date())));
  const viewRef = useRef(view);
  const gate = useRef(createLatestRequestGate());

  const commitView = useCallback((next: TeamScreenState) => {
    viewRef.current = next;
    setView(next);
  }, []);

  const load = useCallback(async (targetDate: string) => {
    commitView(beginTeamScreenLoad(viewRef.current, targetDate));
    const result = await requestLatestTeamSchedule(
      apiClient.getTeamSchedule,
      teamRange("today", targetDate),
      gate.current,
    );
    const next = applyTeamScreenLoadResult(viewRef.current, targetDate, result);
    if (next) commitView(next);
  }, [commitView]);

  useEffect(() => {
    void load(viewRef.current.targetDate);
    return () => gate.current.invalidate();
  }, [load]);

  useEffect(() => {
    function onVisible() {
      const current = viewRef.current;
      if (
        document.visibilityState === "visible"
        && !current.loading
        && !current.error
      ) {
        void load(current.displayDate);
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  function move(days: number) {
    if (view.loading) return;
    const targetDate = toISODate(addDays(parseISODate(view.displayDate), days));
    void load(targetDate);
  }

  return (
    <ScreenScroll style={{ padding: `8px 12px ${TAB_BAR_CLEARANCE}` }}>
      <div className="team-screen">
        <Title level="2" weight="2">
          Команда
        </Title>
        <TeamRangeNav
          label={formatDayLabel(view.displayDate)}
          busy={view.loading}
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
            <button type="button" onClick={() => void load(view.targetDate)}>
              Повторить
            </button>
          </div>
        )}
        {!view.schedule && view.loading && <Spinner size="m" />}
        {view.schedule && (
          <TeamTodayView
            model={buildTodayModel(view.displayDate, view.schedule, templates)}
          />
        )}
      </div>
    </ScreenScroll>
  );
}
