import { useEffect, useState } from "react";
import { FOOD_NO_PLACES, formatMoney, menuPreview, orderStatusLabel } from "@planer/shared";
import { apiClient, type OrderView, type PlaceView, type PollView } from "../../api/client";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ActionButton, Card, Group, Hint } from "../../ui";
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
    <div className="ui-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="ui-screen__title">Заказы и опросы</h1>
        <ActionButton compact kind="quiet" onClick={onClose}>Закрыть</ActionButton>
      </div>
      <div style={{ display: "flex", gap: 8, padding: "8px 0", flexWrap: "wrap" }}>
        <ActionButton compact onClick={() => setRoute({ view: "new-order" })}>🍱 Новый заказ</ActionButton>
        <ActionButton compact onClick={() => setRoute({ view: "new-poll" })}>🗳 Новый опрос</ActionButton>
        <ActionButton compact onClick={() => setRoute({ view: "places" })}>🍴 Места и меню</ActionButton>
      </div>
      {orders === "error" && (
        <div>Заказы не загрузились. <ActionButton compact kind="quiet" onClick={() => setAttempt((n) => n + 1)}>Повторить</ActionButton></div>
      )}
      {Array.isArray(orders) && orders.length > 0 && (
        <Group>
          {orders.map((o) => {
            // Формула статуса общая с консолью и экраном заказа — `orderStatusLabel`.
            const status = orderStatusLabel(o);
            return (
              <Card key={`order-${o.id}`}>
                <div style={{ fontWeight: 600, fontSize: "var(--app-text-body)" }}>🍱 {o.placeName ?? "Заказ без меню"}</div>
                <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
                  Собирает {o.creatorName} · {status}
                </div>
                {o.myTotal > 0 && <div style={{ fontSize: "var(--app-text-meta)" }}>Твой заказ: {formatMoney(o.myTotal)}</div>}
                <ActionButton compact onClick={() => setRoute({ view: "order", orderId: o.id })}>Открыть</ActionButton>
              </Card>
            );
          })}
        </Group>
      )}
      {polls === null && orders === null && <Hint>Загружаю…</Hint>}
      {polls === "error" && (
        <div>Не удалось загрузить. <ActionButton compact kind="quiet" onClick={() => setAttempt((n) => n + 1)}>Повторить</ActionButton></div>
      )}
      {Array.isArray(polls) && polls.length === 0 && Array.isArray(orders) && orders.length === 0 && (
        <Hint>Пока ничего не запускали.</Hint>
      )}
      {Array.isArray(polls) && polls.length > 0 && (
        <Group>{polls.map((p) => <PollCard key={p.id} poll={p} />)}</Group>
      )}
    </div>
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
    <div className="ui-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="ui-screen__title">Места и меню</h1>
        <ActionButton compact kind="quiet" onClick={onBack}>Назад</ActionButton>
      </div>
      <div style={{ padding: "8px 0" }}>
        <ActionButton compact onClick={() => setView({ mode: "editor", place: null })}>+ Место</ActionButton>
      </div>
      {archiveError && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)", paddingBottom: 8 }}>{archiveError}</div>}
      {places === null && <Hint>Загружаю…</Hint>}
      {places === "error" && (
        <div>Не удалось загрузить. <ActionButton compact kind="quiet" onClick={() => setAttempt((n) => n + 1)}>Повторить</ActionButton></div>
      )}
      {Array.isArray(places) && places.length === 0 && <Hint>{FOOD_NO_PLACES}</Hint>}
      {Array.isArray(places) && places.length > 0 && (
        <Group>
          {places.map((p) => (
            <Card key={p.id}>
              <div style={{ fontWeight: 600, fontSize: "var(--app-text-body)" }}>🍴 {p.name}</div>
              <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
                {menuPreview(p.menu)}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <ActionButton compact onClick={() => setView({ mode: "editor", place: p })}>Изменить</ActionButton>
                <ConfirmButton label="Удалить" question={`Удалить «${p.name}»?`} confirmLabel="Удалить"
                  onConfirm={() => archive(p.id)} disabled={busyId === p.id} loading={busyId === p.id} />
              </div>
            </Card>
          ))}
        </Group>
      )}
    </div>
  );
}
