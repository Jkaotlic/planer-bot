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
import { withBusy, withoutBusy } from "./lib/busy-set";
import { withError, withoutError } from "./lib/error-map";
import { swapCandidates } from "./lib/swap-candidates";

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
  // Sets, not single ids: several rows (two pending swaps, two open weekend
  // slots) can each have their own request in flight, and a shared id would
  // let a tap on one row re-enable another row's buttons mid-request.
  const [busySwapIds, setBusySwapIds] = useState<ReadonlySet<number>>(new Set());
  const [busySlotIds, setBusySlotIds] = useState<ReadonlySet<number>>(new Set());
  const [busyOfferIds, setBusyOfferIds] = useState<ReadonlySet<number>>(new Set());
  // Errors from a user's own tap (Принять/Отклонить/…) — shown right on the
  // card they tapped, in human Russian regardless of what the server actually
  // said (its reason codes, e.g. "not_pending", are not meant for display).
  // Keyed by id for the same reason the busy sets are: this is one long scroll
  // with no overlay anywhere, so a message drawn above the list is off-screen
  // for every card the reader had to scroll to. Cleared on the next attempt on
  // that card and on leaving the tab.
  const [swapErrors, setSwapErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const [slotErrors, setSlotErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const [offerErrors, setOfferErrors] = useState<ReadonlyMap<number, string>>(new Map());
  // Расписание за день отдаваемой смены. Грузится отдельно от недельного:
  // «Обменять» доступно и на смене через три недели, а недельная выборка про неё
  // ничего не знает — раньше в этом случае экран показывал пустой список.
  const [dayShifts, setDayShifts] = useState<{ date: string; shifts: Shift[] } | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [dayError, setDayError] = useState<string | null>(null);
  // reloadData is a background refresh (tab switch, regained focus) the user
  // never asked for directly, so its failure gets a quieter, app-wide notice
  // instead of a per-screen error — nothing to retry by hand, it just says the
  // data on screen might be stale, and clears itself once a refresh succeeds.
  const [refreshError, setRefreshError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!proposingFor) {
      setDayShifts(null);
      setDayError(null);
      return;
    }
    let cancelled = false;
    const date = proposingFor.date;
    setDayLoading(true);
    setDayError(null);
    apiClient
      .getTeamSchedule(date, date)
      .then((schedule) => {
        if (!cancelled) setDayShifts({ date, shifts: schedule.shifts });
      })
      .catch((err: unknown) => {
        console.error("Day schedule failed:", err);
        if (!cancelled) setDayError("Не удалось загрузить, кто работает в этот день.");
      })
      .finally(() => {
        if (!cancelled) setDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proposingFor]);

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

  /** `failureMessage` is a fixed, already-Russian sentence — never the
   *  server's `err.message` — because a rejected swap action's reason is a
   *  bare code like "not_pending" (the counterparty already answered it),
   *  not something to show a worker verbatim. */
  async function runSwapAction(id: number, action: (id: number) => Promise<void>, failureMessage: string) {
    setBusySwapIds((prev) => withBusy(prev, id));
    setSwapErrors((prev) => withoutError(prev, id));
    try {
      await action(id);
      await refreshSwaps();
    } catch (err) {
      console.error("Swap action failed:", err);
      setSwapErrors((prev) => withError(prev, id, failureMessage));
    } finally {
      setBusySwapIds((prev) => withoutBusy(prev, id));
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
      setRefreshError(null);
    } catch (err) {
      console.error("Refresh failed:", err);
      // Quiet, not urgent — the worker didn't ask for this refresh, and what's
      // already on screen is still whatever the last successful load showed.
      setRefreshError("Не получилось обновить данные — показываем то, что уже загружено.");
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
    setBusySlotIds((prev) => withBusy(prev, slotId));
    setSlotErrors((prev) => withoutError(prev, slotId));
    try {
      await apiClient.expressInterest(slotId);
      await refreshWeekend();
    } catch (err) {
      console.error("Interest action failed:", err);
      setSlotErrors((prev) => withError(prev, slotId, "Не получилось записаться на смену. Попробуй ещё раз."));
    } finally {
      setBusySlotIds((prev) => withoutBusy(prev, slotId));
    }
  }

  /** See `runSwapAction` — same reasoning for a fixed Russian `failureMessage`. */
  async function runOfferAction(id: number, action: (id: number) => Promise<void>, failureMessage: string) {
    setBusyOfferIds((prev) => withBusy(prev, id));
    setOfferErrors((prev) => withoutError(prev, id));
    try {
      await action(id);
      await refreshWeekend();
    } catch (err) {
      console.error("Offer action failed:", err);
      setOfferErrors((prev) => withError(prev, id, failureMessage));
    } finally {
      setBusyOfferIds((prev) => withoutBusy(prev, id));
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
    // Только свой день: пока грузится другой, показывать прежние строки нельзя —
    // это чужой день, и человек предложит обмен не туда.
    const day = dayShifts?.date === proposingFor.date ? dayShifts.shifts : [];
    const { candidates, sameKindCount } = swapCandidates(proposingFor, day, data.me.id, new Date());
    return (
      <ProposeSwapScreen
        fromShift={proposingFor}
        candidates={candidates}
        sameKindCount={sameKindCount}
        loading={dayLoading}
        loadError={dayError}
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
          onAddressChanged={({ preferredName, address }) =>
            setData((prev) => (prev ? { ...prev, me: { ...prev.me, preferredName, address } } : prev))
          }
        />
      )}
      {tab === "team" && <TeamScreen templates={data.templates} />}
      {tab === "swaps" && (
        <SwapsScreen
          swaps={data.swaps}
          busyIds={busySwapIds}
          actionErrors={swapErrors}
          onAccept={(id) =>
            void runSwapAction(id, apiClient.acceptSwap, "Не получилось принять обмен — возможно, его уже обработали. Обнови экран и попробуй снова.")
          }
          onDecline={(id) =>
            void runSwapAction(id, apiClient.declineSwap, "Не получилось отклонить обмен — возможно, его уже обработали. Обнови экран и попробуй снова.")
          }
          onCancel={(id) =>
            void runSwapAction(id, apiClient.cancelSwap, "Не получилось отменить обмен — возможно, он уже решён. Обнови экран и попробуй снова.")
          }
        />
      )}
      {tab === "weekend" && (
        <WeekendScreen
          slots={data.weekendSlots}
          offers={data.weekendOffers}
          busySlotIds={busySlotIds}
          busyOfferIds={busyOfferIds}
          slotErrors={slotErrors}
          offerErrors={offerErrors}
          onInterest={(id) => void handleInterest(id)}
          onConfirm={(id) =>
            void runOfferAction(id, apiClient.confirmOffer, "Не получилось подтвердить смену — возможно, её уже забрали. Обнови экран и попробуй снова.")
          }
          onDecline={(id) =>
            void runOfferAction(id, apiClient.declineOffer, "Не получилось отказаться от смены. Попробуй ещё раз.")
          }
        />
      )}
      {tab === "admin" && data.me.isAdmin && <AdminScreen />}
      {refreshError && (
        <div
          role="status"
          style={{
            padding: "8px 16px",
            textAlign: "center",
            fontSize: 12.5,
            color: "var(--tgui--hint_color)",
            background: "var(--tgui--secondary_bg_color)",
          }}
        >
          {refreshError}
        </div>
      )}
      <TabBar
        active={tab}
        onChange={(t) => {
          setTab(t);
          // A stale action error from wherever we're leaving shouldn't greet us
          // on the next visit to that tab.
          setSwapErrors(new Map());
          setSlotErrors(new Map());
          setOfferErrors(new Map());
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
