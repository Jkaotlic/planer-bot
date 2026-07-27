import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner, Title } from "@telegram-apps/telegram-ui";
import { apiClient, type TeamSchedule, type Template } from "../api/client";
import { ScreenScroll } from "../components/ScreenScroll";
import {
  buildTodayModel,
  createLatestRequestGate,
  requestLatestTeamSchedule,
  teamRange,
} from "../lib/team-schedule";
import { addDays, formatDayLabel, parseISODate, toISODate } from "../lib/week";
import { TeamRangeNav } from "./team/TeamRangeNav";
import { TeamTodayView } from "./team/TeamTodayView";
import "./team/team-schedule.css";

export function TeamScreen({ templates }: { templates: readonly Template[] }) {
  const [selectedDate, setSelectedDate] = useState(() => toISODate(new Date()));
  const [schedule, setSchedule] = useState<TeamSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gate = useRef(createLatestRequestGate());
  const range = useMemo(() => teamRange("today", selectedDate), [selectedDate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await requestLatestTeamSchedule(
      apiClient.getTeamSchedule,
      range,
      gate.current,
    );
    if (result.status === "stale") return;
    if (result.status === "failed") {
      setError(
        result.error instanceof Error
          ? result.error.message
          : "Не удалось загрузить расписание",
      );
    } else {
      setSchedule(result.schedule);
    }
    setLoading(false);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  function move(days: number) {
    setSelectedDate(toISODate(addDays(parseISODate(selectedDate), days)));
  }

  return (
    <ScreenScroll style={{ padding: "8px 12px 96px" }}>
      <div className="team-screen">
        <Title level="2" weight="2">
          Команда
        </Title>
        <TeamRangeNav
          label={formatDayLabel(selectedDate)}
          busy={loading}
          onPrevious={() => move(-1)}
          onNext={() => move(1)}
        />
        {loading && (
          <div className="team-refreshing" role="status">
            Обновляем…
          </div>
        )}
        {error && (
          <div className="team-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void load()}>
              Повторить
            </button>
          </div>
        )}
        {!schedule && loading && <Spinner size="m" />}
        {schedule && (
          <TeamTodayView model={buildTodayModel(selectedDate, schedule, templates)} />
        )}
      </div>
    </ScreenScroll>
  );
}
