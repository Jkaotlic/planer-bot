import { useEffect, useState } from "react";
import { Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type Me, type Shift, type SwapRequest } from "./api/client";
import { TabBar, type TabKey } from "./components/TabBar";
import { MyShiftsScreen } from "./screens/MyShiftsScreen";
import { ProposeSwapScreen } from "./screens/ProposeSwapScreen";
import { SwapsScreen } from "./screens/SwapsScreen";
import { TeamScreen } from "./screens/TeamScreen";
import { addDays, mondayOf, toISODate } from "./lib/week";

interface AppData {
  me: Me;
  myShifts: Shift[];
  teamShifts: Shift[];
  swaps: SwapRequest[];
}

/** App shell: bootstraps the session + this week's data once, then switches
 * between screens via the bottom tab bar. The "Предложить обмен" flow is a
 * lightweight overlay state (not a tab) opened from a shift's "Обменять"
 * affordance, with its own back action instead of the tab bar. */
export function App() {
  const [tab, setTab] = useState<TabKey>("mine");
  const [proposingFor, setProposingFor] = useState<Shift | null>(null);
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySwapId, setBusySwapId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const monday = mondayOf(new Date());
    const from = toISODate(monday);
    const to = toISODate(addDays(monday, 6));

    apiClient
      .getMe()
      .then((me) =>
        Promise.all([
          Promise.resolve(me),
          apiClient.getMyShifts(from),
          apiClient.getTeamSchedule(from, to),
          apiClient.getSwaps(),
        ]),
      )
      .then(([me, myShifts, teamShifts, swaps]) => {
        if (!cancelled) setData({ me, myShifts, teamShifts, swaps });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось загрузить данные");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSwaps() {
    const swaps = await apiClient.getSwaps();
    setData((prev) => (prev ? { ...prev, swaps } : prev));
  }

  async function handleConfirmSwap(toShiftId: number, message: string) {
    if (!proposingFor) return;
    await apiClient.proposeSwap(proposingFor.id, toShiftId, message || undefined);
    setProposingFor(null);
    setTab("mine");
    await refreshSwaps();
  }

  async function runSwapAction(id: number, action: (id: number) => Promise<void>) {
    setBusySwapId(id);
    try {
      await action(id);
      await refreshSwaps();
    } catch (err) {
      console.error("Swap action failed:", err);
    } finally {
      setBusySwapId(null);
    }
  }

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

  if (proposingFor) {
    const colleagueShifts = data.teamShifts.filter(
      (s) => s.category === "shift" && s.employeeId !== data.me.id,
    );
    return (
      <ProposeSwapScreen
        fromShift={proposingFor}
        colleagueShifts={colleagueShifts}
        onCancel={() => setProposingFor(null)}
        onConfirm={handleConfirmSwap}
      />
    );
  }

  return (
    <div style={{ minHeight: "100vh", boxSizing: "border-box" }}>
      {tab === "mine" && (
        <MyShiftsScreen me={data.me} shifts={data.myShifts} onProposeSwap={setProposingFor} />
      )}
      {tab === "team" && <TeamScreen shifts={data.teamShifts} />}
      {tab === "swaps" && (
        <SwapsScreen
          swaps={data.swaps}
          busyId={busySwapId}
          onAccept={(id) => void runSwapAction(id, apiClient.acceptSwap)}
          onDecline={(id) => void runSwapAction(id, apiClient.declineSwap)}
          onCancel={(id) => void runSwapAction(id, apiClient.cancelSwap)}
        />
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
