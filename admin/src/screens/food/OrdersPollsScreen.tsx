import { useEffect, useState } from "react";
import { formatMoney, orderInProgress, orderStatusLabel } from "@planer/shared";
import { apiClient, type OrderView, type PollView } from "../../api/client";
import { CollapsibleArchive } from "../../components/CollapsibleArchive";
import { failureText } from "./food-errors";
import { OrderForm } from "./OrderForm";
import { OrderScreen } from "./OrderScreen";
import { PollCard } from "./PollCard";
import { PollForm } from "./PollForm";

/** Куда ведёт экран. Навигация — внутри пункта меню, как у «Сборов»: сайдбар остаётся на месте. */
export type FoodView =
  | { view: "list" }
  | { view: "new-order" }
  | { view: "new-poll" }
  | { view: "order"; orderId: number }
  | { view: "places" };

/**
 * «Заказы и опросы» в консоли — те же заказы и опросы, что видит этот человек в
 * мини-аппе: свои и те, куда позвали (сервер отдаёт до 20 последних каждого вида).
 * Идущие — сразу, прошедшие — свёрнуты: закрытые отодвигали бы живые.
 */
export function OrdersPollsScreen({ onAuthRequired }: { onAuthRequired(): void }) {
  const [route, setRoute] = useState<FoodView>({ view: "list" });
  const [orders, setOrders] = useState<OrderView[] | null>(null);
  const [polls, setPolls] = useState<PollView[] | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [pollsError, setPollsError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Перечитывается при каждом возврате к списку: заказ мог закрыться тиком, пока
  // админ был в форме. `onAuthRequired` в зависимостях нет намеренно: `App`
  // передаёт новую стрелку на каждый свой рендер, и список перечитывался бы зря.
  useEffect(() => {
    if (route.view !== "list") return;
    let alive = true;
    setOrders(null);
    setPolls(null);
    setOrdersError(null);
    setPollsError(null);
    apiClient.getOrders()
      .then((list) => { if (alive) setOrders(list); })
      .catch((err) => { if (alive) setOrdersError(failureText(err, "Заказы не загрузились.", onAuthRequired)); });
    apiClient.getPolls()
      .then((list) => { if (alive) setPolls(list); })
      .catch((err) => { if (alive) setPollsError(failureText(err, "Не удалось загрузить.", onAuthRequired)); });
    return () => { alive = false; };
  }, [route, attempt]);

  const toList = () => setRoute({ view: "list" });
  if (route.view === "new-order") {
    return <OrderForm onDone={(orderId) => setRoute({ view: "order", orderId })} onCancel={toList} onAuthRequired={onAuthRequired} />;
  }
  if (route.view === "new-poll") return <PollForm onDone={toList} onCancel={toList} onAuthRequired={onAuthRequired} />;
  if (route.view === "order") return <OrderScreen orderId={route.orderId} onBack={toList} onAuthRequired={onAuthRequired} />;

  const retry = () => setAttempt((n) => n + 1);
  const activeOrders = orders?.filter(orderInProgress) ?? [];
  const pastOrders = orders?.filter((o) => !orderInProgress(o)) ?? [];
  const activePolls = polls?.filter((p) => p.open) ?? [];
  const pastPolls = polls?.filter((p) => !p.open) ?? [];
  const renderOrders = (list: readonly OrderView[]) => (
    <div className="food-list">{list.map((o) => <OrderCard key={o.id} order={o} onOpen={() => setRoute({ view: "order", orderId: o.id })} />)}</div>
  );
  const renderPolls = (list: readonly PollView[]) => (
    <div className="food-list">{list.map((p) => <PollCard key={p.id} poll={p} onAuthRequired={onAuthRequired} />)}</div>
  );

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Заказы и опросы</h2>
      </div>
      <div className="food-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => setRoute({ view: "new-order" })}>🍱 Новый заказ</button>
        <button type="button" className="btn btn-secondary" onClick={() => setRoute({ view: "new-poll" })}>🗳 Новый опрос</button>
      </div>
      {(orders === null && !ordersError) || (polls === null && !pollsError) ? (
        <div className="employees-empty">Загрузка…</div>
      ) : null}
      {orders?.length === 0 && polls?.length === 0 && <div className="empty-state">Пока ничего не запускали.</div>}
      {(ordersError || (orders && orders.length > 0)) && (
        <section className="employees-section" aria-label="Заказы">
          <h3 className="employees-section-title">Заказы</h3>
          {ordersError && (
            <div className="employees-error" role="alert">
              {ordersError}{" "}
              <button type="button" className="btn btn-secondary btn-compact" onClick={retry}>Повторить</button>
            </div>
          )}
          {activeOrders.length > 0 && renderOrders(activeOrders)}
          <CollapsibleArchive title="Прошедшие заказы" items={pastOrders}>{renderOrders}</CollapsibleArchive>
        </section>
      )}
      {(pollsError || (polls && polls.length > 0)) && (
        <section className="employees-section" aria-label="Опросы">
          <h3 className="employees-section-title">Опросы</h3>
          {pollsError && (
            <div className="employees-error" role="alert">
              {pollsError}{" "}
              <button type="button" className="btn btn-secondary btn-compact" onClick={retry}>Повторить</button>
            </div>
          )}
          {activePolls.length > 0 && renderPolls(activePolls)}
          <CollapsibleArchive title="Прошедшие опросы" items={pastPolls}>{renderPolls}</CollapsibleArchive>
        </section>
      )}
    </div>
  );
}

/** Карточка заказа в списке; «Открыть» ведёт на экран заказа. */
function OrderCard({ order, onOpen }: { order: OrderView; onOpen?: () => void }) {
  return (
    <article className="food-card">
      <div className="food-card-title">🍱 {order.placeName ?? "Заказ без меню"}</div>
      <div className="food-meta">Собирает {order.creatorName} · {orderStatusLabel(order)}</div>
      {order.myTotal > 0 && <div className="food-note">Твой заказ: {formatMoney(order.myTotal)}</div>}
      {onOpen && (
        <div className="food-buttons">
          <button type="button" className="btn btn-secondary btn-compact" onClick={onOpen}>Открыть</button>
        </div>
      )}
    </article>
  );
}
