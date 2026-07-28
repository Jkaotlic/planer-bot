import { useEffect, useState } from "react";
import { Placeholder, Spinner } from "@telegram-apps/telegram-ui";
import { apiClient, type Me, type Shift, type SwapRequest, type Template, type WeekendSlotView, type WeekendOffer } from "./api/client";
import { TabBar, type TabKey } from "./components/TabBar";
import { MyShiftsScreen } from "./screens/MyShiftsScreen";
import { ProposeSwapScreen } from "./screens/ProposeSwapScreen";
import { SwapsScreen } from "./screens/SwapsScreen";
import { TeamScreen } from "./screens/TeamScreen";
import { WeekendScreen } from "./screens/WeekendScreen";
import { AdminScreen } from "./screens/AdminScreen";
import { addDays, mondayOf, toISODate } from "./lib/week";

interface AppData {
  me: Me;
  myShifts: Shift[];
  teamShifts: Shift[];
  /** Presets — the entry rows colour themselves by the one each entry came from. */
  templates: Template[];
  swaps: SwapRequest[];
  weekendSlots: WeekendSlotView[];
  weekendOffers: WeekendOffer[];
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
  const [busySlotId, setBusySlotId] = useState<number | null>(null);
  const [busyOfferId, setBusyOfferId] = useState<number | null>(null);

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
          apiClient.getTeamSchedule(from, to).then((schedule) => schedule.shifts),
          apiClient.getTemplates(),
          apiClient.getSwaps(),
          apiClient.getWeekendSlots(),
          apiClient.getWeekendOffers(),
        ]),
      )
      .then(([me, myShifts, teamShifts, templates, swaps, weekendSlots, weekendOffers]) => {
        if (!cancelled) setData({ me, myShifts, teamShifts, templates, swaps, weekendSlots, weekendOffers });
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

  async function refreshWeekend() {
    const [weekendSlots, weekendOffers] = await Promise.all([apiClient.getWeekendSlots(), apiClient.getWeekendOffers()]);
    setData((prev) => (prev ? { ...prev, weekendSlots, weekendOffers } : prev));
  }

  /** Re-pull every worker-facing view. Called on tab switch and when the app
   * regains focus, so an admin's schedule edits (or a colleague's swap) appear
   * without fully reopening the mini app. */
  async function reloadData() {
    const monday = mondayOf(new Date());
    const from = toISODate(monday);
    const to = toISODate(addDays(monday, 6));
    try {
      const [myShifts, teamShifts, templates, swaps, weekendSlots, weekendOffers] = await Promise.all([
        apiClient.getMyShifts(from),
        apiClient.getTeamSchedule(from, to).then((schedule) => schedule.shifts),
        // Re-pulled with the rest so an admin's preset edits (a renamed or
        // recoloured Утро/День/…) reach the worker's rows too.
        apiClient.getTemplates(),
        apiClient.getSwaps(),
        apiClient.getWeekendSlots(),
        apiClient.getWeekendOffers(),
      ]);
      setData((prev) => (prev ? { ...prev, myShifts, teamShifts, templates, swaps, weekendSlots, weekendOffers } : prev));
    } catch (err) {
      console.error("Refresh failed:", err);
    }
  }

  // Refresh when the mini app comes back to the foreground (e.g. after the admin
  // edited shifts, or a reminder pulled the worker back in).
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void reloadData();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // reloadData only closes over stable refs (apiClient/setData); safe to bind once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInterest(slotId: number) {
    setBusySlotId(slotId);
    try {
      await apiClient.expressInterest(slotId);
      await refreshWeekend();
    } catch (err) {
      console.error("Interest action failed:", err);
    } finally {
      setBusySlotId(null);
    }
  }

  async function runOfferAction(id: number, action: (id: number) => Promise<void>) {
    setBusyOfferId(id);
    try {
      await action(id);
      await refreshWeekend();
    } catch (err) {
      console.error("Offer action failed:", err);
    } finally {
      setBusyOfferId(null);
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
        <MyShiftsScreen
          me={data.me}
          shifts={data.myShifts}
          templates={data.templates}
          onProposeSwap={setProposingFor}
          onRemindersChanged={(remindersEnabled) =>
            setData((prev) => (prev ? { ...prev, me: { ...prev.me, remindersEnabled } } : prev))
          }
        />
      )}
      {tab === "team" && <TeamScreen templates={data.templates} />}
      {tab === "swaps" && (
        <SwapsScreen
          swaps={data.swaps}
          busyId={busySwapId}
          onAccept={(id) => void runSwapAction(id, apiClient.acceptSwap)}
          onDecline={(id) => void runSwapAction(id, apiClient.declineSwap)}
          onCancel={(id) => void runSwapAction(id, apiClient.cancelSwap)}
        />
      )}
      {tab === "weekend" && (
        <WeekendScreen
          slots={data.weekendSlots}
          offers={data.weekendOffers}
          busySlotId={busySlotId}
          busyOfferId={busyOfferId}
          onInterest={(id) => void handleInterest(id)}
          onConfirm={(id) => void runOfferAction(id, apiClient.confirmOffer)}
          onDecline={(id) => void runOfferAction(id, apiClient.declineOffer)}
        />
      )}
      {tab === "admin" && data.me.isAdmin && <AdminScreen />}
      <TabBar
        active={tab}
        onChange={(t) => {
          setTab(t);
          // Leaving the Админ tab (or any switch) re-pulls data so edits show immediately.
          void reloadData();
        }}
        isAdmin={data.me.isAdmin}
      />
    </div>
  );
}

const centeredStyle = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;
