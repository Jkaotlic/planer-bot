import { useEffect, useState } from "react";
import { Button, Title } from "@telegram-apps/telegram-ui";
import { formatMoney } from "@planer/shared";
import { apiClient, type OrderView, type PlaceView, type PollView } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ScreenScroll } from "../../components/ScreenScroll";
import type { FoodRoute } from "./food-route";
import { OrderForm } from "./OrderForm";
import { OrderScreen } from "./OrderScreen";
import { PlaceEditor } from "./PlaceEditor";
import { PollCard } from "./PollCard";
import { PollForm } from "./PollForm";

/**
 * Экран «Заказы и опросы» — оверлей поверх вкладок, а не новая вкладка: в
 * таб-баре уже семь мест, а сюда приходят из бота по ссылке с `?screen=orders`.
 */
export function FoodScreen({ initial, onClose }: { initial: FoodRoute; onClose(): void }) {
  const [route, setRoute] = useState<FoodRoute>(initial);
  const [polls, setPolls] = useState<PollView[] | null | "error">(null);
  const [orders, setOrders] = useState<OrderView[] | null | "error">(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (route.view !== "list") return;
    let alive = true;
    setPolls(null);
    setOrders(null);
    apiClient.getPolls().then((p) => { if (alive) setPolls(p); }).catch(() => { if (alive) setPolls("error"); });
    apiClient.getOrders().then((o) => { if (alive) setOrders(o); }).catch(() => { if (alive) setOrders("error"); });
    return () => { alive = false; };
  }, [route, attempt]);

  const toList = () => setRoute({ view: "list" });
  if (route.view === "new-poll") return <PollForm onDone={toList} onCancel={toList} />;
  if (route.view === "new-order") {
    return (
      <OrderForm
        onDone={(orderId) => setRoute({ view: "order", orderId })}
        onCancel={toList}
        onEditPlaces={() => setRoute({ view: "places" })}
      />
    );
  }
  if (route.view === "order") return <OrderScreen orderId={route.orderId} onBack={toList} />;
  if (route.view === "places") return <PlacesScreen onBack={toList} />;

  return (
    <ScreenScroll>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level="2" weight="2">Заказы и опросы</Title>
        <Button size="s" mode="plain" onClick={onClose}>Закрыть</Button>
      </div>
      <div style={{ display: "flex", gap: 8, padding: "8px 0", flexWrap: "wrap" }}>
        <Button size="s" mode="bezeled" onClick={() => setRoute({ view: "new-order" })}>🍱 Новый заказ</Button>
        <Button size="s" mode="bezeled" onClick={() => setRoute({ view: "new-poll" })}>🗳 Новый опрос</Button>
        <Button size="s" mode="bezeled" onClick={() => setRoute({ view: "places" })}>🍴 Места и меню</Button>
      </div>
      {orders === "error" && (
        <div>Заказы не загрузились. <Button size="s" mode="plain" onClick={() => setAttempt((n) => n + 1)}>Повторить</Button></div>
      )}
      {Array.isArray(orders) && orders.length > 0 && (
        <CardStack>
          {orders.map((o) => {
            // Та же формула, что в OrderScreen/PollCard: `o.closes` — просто
            // форматированный срок, он не гаснет сам, когда заказ закрыт или
            // отменён (ревью раунд 1, находка №1) — карточка иначе показывала
            // бы «до 12:30» и закрытому, и отменённому заказу.
            const status = o.cancelled ? "отменён" : o.open ? (o.closes ?? "приём идёт") : "приём закрыт";
            return (
              <CardShell key={`order-${o.id}`}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>🍱 {o.placeName ?? "Заказ без меню"}</div>
                <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
                  Собирает {o.creatorName} · {status}
                </div>
                {o.myTotal > 0 && <div style={{ fontSize: 13.5 }}>Твой заказ: {formatMoney(o.myTotal)}</div>}
                <Button size="s" mode="bezeled" onClick={() => setRoute({ view: "order", orderId: o.id })}>Открыть</Button>
              </CardShell>
            );
          })}
        </CardStack>
      )}
      {polls === null && orders === null && <div style={{ color: "var(--tgui--hint_color)" }}>Загружаю…</div>}
      {polls === "error" && (
        <div>Не удалось загрузить. <Button size="s" mode="plain" onClick={() => setAttempt((n) => n + 1)}>Повторить</Button></div>
      )}
      {Array.isArray(polls) && polls.length === 0 && Array.isArray(orders) && orders.length === 0 && (
        <div style={{ color: "var(--tgui--hint_color)" }}>Пока ничего не запускали.</div>
      )}
      {Array.isArray(polls) && polls.length > 0 && (
        <CardStack>{polls.map((p) => <PollCard key={p.id} poll={p} />)}</CardStack>
      )}
    </ScreenScroll>
  );
}

type PlacesView = { mode: "list" } | { mode: "editor"; place: PlaceView | null };

/**
 * Список мест с меню и их правка — своя загрузка, отдельная от опросов:
 * место общее для всей команды и не связано со сроком закрытия опроса.
 */
function PlacesScreen({ onBack }: { onBack(): void }) {
  const [view, setView] = useState<PlacesView>({ mode: "list" });
  const [places, setPlaces] = useState<PlaceView[] | null | "error">(null);
  const [attempt, setAttempt] = useState(0);
  // Кто именно архивируется — а не общий флаг: иначе тап «Удалить» на одной
  // карточке гасил бы кнопки у всех остальных мест в списке.
  const [busyId, setBusyId] = useState<number | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    if (view.mode !== "list") return;
    let alive = true;
    setPlaces(null);
    apiClient.getFoodPlaces().then((p) => { if (alive) setPlaces(p); }).catch(() => { if (alive) setPlaces("error"); });
    return () => { alive = false; };
  }, [view, attempt]);

  if (view.mode === "editor") {
    return (
      <PlaceEditor
        place={view.place}
        onCancel={() => setView({ mode: "list" })}
        onSaved={() => { setView({ mode: "list" }); setAttempt((n) => n + 1); }}
      />
    );
  }

  async function archive(id: number) {
    setBusyId(id);
    setArchiveError(null);
    try {
      await apiClient.archiveFoodPlace(id);
      setAttempt((n) => n + 1);
    } catch (err) {
      // Отказ (например, место уже удалено кем-то другим между открытием
      // списка и тапом «Удалить» — 404 «Места больше нет.») раньше терялся
      // молча: `try/finally` без `catch` оставлял необработанный rejection и
      // ничего не говорил человеку. Список всё равно перечитывается — если
      // причина именно в том, что место уже пропало, реальное состояние само
      // покажет это в перезагруженном списке.
      setArchiveError(err instanceof Error ? err.message : "Не удалось удалить место");
      setAttempt((n) => n + 1);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScreenScroll>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Title level="2" weight="2">Места и меню</Title>
        <Button size="s" mode="plain" onClick={onBack}>Назад</Button>
      </div>
      <div style={{ padding: "8px 0" }}>
        <Button size="s" mode="bezeled" onClick={() => setView({ mode: "editor", place: null })}>+ Место</Button>
      </div>
      {archiveError && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13, paddingBottom: 8 }}>{archiveError}</div>}
      {places === null && <div style={{ color: "var(--tgui--hint_color)" }}>Загружаю…</div>}
      {places === "error" && (
        <div>Не удалось загрузить. <Button size="s" mode="plain" onClick={() => setAttempt((n) => n + 1)}>Повторить</Button></div>
      )}
      {Array.isArray(places) && places.length === 0 && <div style={{ color: "var(--tgui--hint_color)" }}>Мест ещё нет.</div>}
      {Array.isArray(places) && places.length > 0 && (
        <CardStack>
          {places.map((p) => (
            <CardShell key={p.id}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>🍴 {p.name}</div>
              <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
                {p.menu.length > 0 ? p.menu.map((m) => `${m.name} — ${m.price} ₽`).join(", ") : "Меню пусто"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button size="s" mode="bezeled" onClick={() => setView({ mode: "editor", place: p })}>Изменить</Button>
                <ConfirmButton label="Удалить" question={`Удалить «${p.name}»?`} confirmLabel="Удалить"
                  onConfirm={() => archive(p.id)} disabled={busyId === p.id} loading={busyId === p.id} />
              </div>
            </CardShell>
          ))}
        </CardStack>
      )}
    </ScreenScroll>
  );
}
