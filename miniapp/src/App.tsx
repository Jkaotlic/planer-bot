import { useEffect, useState } from "react";
import { Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type Me, type Shift } from "./api/client";
import { TabBar, type TabKey } from "./components/TabBar";
import { MyShiftsScreen } from "./screens/MyShiftsScreen";
import { TeamScreen } from "./screens/TeamScreen";
import { addDays, mondayOf, toISODate } from "./lib/week";

interface AppData {
  me: Me;
  myShifts: Shift[];
  teamShifts: Shift[];
}

/** App shell: bootstraps the session + this week's data once, then switches
 * between the two screens via the bottom tab bar. */
export function App() {
  const [tab, setTab] = useState<TabKey>("mine");
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const monday = mondayOf(new Date());
    const from = toISODate(monday);
    const to = toISODate(addDays(monday, 6));

    apiClient
      .getMe()
      .then((me) =>
        Promise.all([Promise.resolve(me), apiClient.getMyShifts(from), apiClient.getTeamSchedule(from, to)]),
      )
      .then(([me, myShifts, teamShifts]) => {
        if (!cancelled) setData({ me, myShifts, teamShifts });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div style={centeredStyle}>
        <Placeholder header="Не удалось загрузить" description={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div style={centeredStyle}>
        <Spinner size="l" />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", boxSizing: "border-box", paddingBottom: "calc(88px + env(safe-area-inset-bottom))" }}>
      {tab === "mine" ? (
        <MyShiftsScreen me={data.me} shifts={data.myShifts} />
      ) : (
        <TeamScreen shifts={data.teamShifts} />
      )}
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}

const centeredStyle = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;
