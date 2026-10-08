import { useEffect, useState, type ReactNode } from "react";
import {
  FOOD_CASH_MARK, FOOD_PAID_MARKED, FOOD_QTY_MAX, FOOD_TEXT_MAX, FOOD_UNMARK_QUESTION, cancelOrderQuestion, closeOrderQuestion, formatMoney, itemLines, menuItemLabel,
  myOrderEmptyText, myOrderPayment, orderHeadline, orderPersonBlock, orderStatusLabel, payHintLine, priceDigits, remindResultText,
} from "@planer/shared";
import { apiClient, type OrderView } from "../../api/client";
import { ConfirmButton } from "../../components/ConfirmButton";
import { useAuthRequired } from "../../auth-required";
import { failureText } from "./food-errors";

/** Где нажимали — там и показываем отказ. */
type Area = "mine" | "menu" | "custom" | "payments" | "manage";

/**
 * Один заказ — всё, что умеет экран заказа в мини-аппе (`miniapp/src/screens/food/OrderScreen.tsx`).
 * Слева своё, справа то, что видит собирающий; права (`canManage`, `people`,
 * `payment.rows`) посчитал сервер.
 */
export function OrderScreen({ orderId, onBack }: { orderId: number; onBack(): void }) {
  const onAuthRequired = useAuthRequired();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ area: Area; text: string } | null>(null);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [remindResult, setRemindResult] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setOrder(null);
    setLoadError(null);
    apiClient.getOrder(orderId)
      .then((o) => { if (alive) setOrder(o); })
      .catch((err) => { if (alive) setLoadError(failureText(err, "Не удалось загрузить заказ.", onAuthRequired)); });
    return () => { alive = false; };
  }, [orderId, loadAttempt]);

  /**
   * После любого отказа заказ перечитывается: сервер мог закрыть его тиком между
   * рендером и кликом, и погасшие кнопки должны исчезнуть сами, а не висеть до
   * следующего открытия. Отказ перечитывания не страшен — текст ошибки уже виден.
   */
  async function refetch() {
    try {
      setOrder(await apiClient.getOrder(orderId));
    } catch {
      /* остаётся прежний заказ */
    }
  }

  async function run(area: Area, action: () => Promise<OrderView>) {
    setBusy(true);
    setFailure(null);
    setRemindResult(null);
    try {
      setOrder(await action());
    } catch (err) {
      const text = failureText(err, "Не получилось", onAuthRequired);
      if (text) setFailure({ area, text });
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  /** Дожим отдаёт не заказ, а сколько дошло — «Кто сдал» обновится при следующем открытии. */
  async function remind(id: number) {
    setBusy(true);
    setFailure(null);
    setRemindResult(null);
    try {
      setRemindResult(remindResultText(await apiClient.remindOrderUnpaid(id)));
    } catch (err) {
      const text = failureText(err, "Не получилось", onAuthRequired);
      if (text) setFailure({ area: "payments", text });
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="employees-screen">
        <div className="employees-error" role="alert">{loadError}</div>
        <div className="food-buttons">
          <button type="button" className="btn btn-quiet" onClick={onBack}>‹ Назад</button>
          <button type="button" className="btn btn-secondary" onClick={() => setLoadAttempt((n) => n + 1)}>Повторить</button>
        </div>
      </div>
    );
  }
  if (!order) return <div className="employees-empty">Загружаю заказ…</div>;

  const pay = myOrderPayment(order);
  const shown: Record<Area, boolean> = {
    mine: true,
    menu: order.open && order.menu.length > 0,
    custom: order.open && order.allowCustom,
    payments: order.closed && order.payment.rows !== null && order.payment.total > 0,
    manage: order.canManage && order.open,
  };
  const errorIn = (area: Area): ReactNode =>
    failure?.area === area ? <div className="employees-error" role="alert">{failure.text}</div> : null;

  return (
    <div className="employees-screen">
      <button type="button" className="btn btn-quiet btn-compact" onClick={onBack}>‹ Назад</button>
      <div className="employees-header">
        <h2 className="employees-title food-card-title">🍱 {orderHeadline(order)}</h2>
      </div>
      <div className="food-meta">
        Собирает {order.creatorName} · {orderStatusLabel(order)} · ответили {order.respondedCount} из {order.recipientCount}
      </div>
      {order.note && <div className="food-note">{order.note}</div>}
      {order.payHint && <div className="food-note">{payHintLine(order.payHint)}</div>}
      {/* Карточка, где нажимали, могла исчезнуть при перечитывании (меню и «Управление»
          гаснут у закрытого заказа) — тогда отказ здесь, а не пропадает вместе с ней. */}
      {failure && !shown[failure.area] && (
        <div className="employees-error" role="alert" data-area="top">{failure.text}</div>
      )}

      <div className="food-columns">
        <div className="food-column">
          <section className="food-card" data-area="mine">
            <h3 className="food-card-title">Твой заказ</h3>
            {order.myItems.length === 0 && <div className="food-meta">{myOrderEmptyText(order.declined)}</div>}
            {order.myItems.map((item) => (
              <div key={item.id} className="food-row">
                <span className="food-row-name">{itemLines([item])[0]}</span>
                {order.open && (
                  <>
                    <button type="button" className="btn btn-secondary btn-compact" aria-label={`Меньше: ${item.name}`}
                      disabled={busy || item.qty <= 1} onClick={() => void run("mine", () => apiClient.setOrderItemQty(order.id, item.id, item.qty - 1))}>−</button>
                    <button type="button" className="btn btn-secondary btn-compact" aria-label={`Больше: ${item.name}`}
                      disabled={busy || item.qty >= FOOD_QTY_MAX} onClick={() => void run("mine", () => apiClient.setOrderItemQty(order.id, item.id, item.qty + 1))}>+</button>
                    <button type="button" className="btn btn-quiet btn-compact" aria-label={`Убрать: ${item.name}`}
                      disabled={busy} onClick={() => void run("mine", () => apiClient.removeOrderItem(order.id, item.id))}>✕</button>
                  </>
                )}
              </div>
            ))}
            {order.myTotal > 0 && <div className="food-total">Итого: {formatMoney(order.myTotal)}</div>}
            {pay.oweLine && <div>{pay.oweLine}</div>}
            {/* Отметка — не тумблер: снять — отдельно и с подтверждением, как в мини-аппе и в боте. */}
            {pay.mark === "can-mark" && (
              <div className="food-buttons">
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run("mine", () => apiClient.setOrderPaid(order.id, true))}>💸 Я сдал</button>
              </div>
            )}
            {pay.mark === "marked" && (
              <div className="food-row">
                <span>{FOOD_PAID_MARKED}</span>
                <ConfirmButton label="Снять отметку" question={FOOD_UNMARK_QUESTION} confirmLabel="Снять" disabled={busy}
                  onConfirm={() => void run("mine", () => apiClient.setOrderPaid(order.id, false))} />
              </div>
            )}
            {errorIn("mine")}
          </section>

          {shown.menu && (
            <section className="food-card" data-area="menu">
              <h3 className="food-card-title">Меню</h3>
              <div className="food-buttons">
                {order.menu.map((m) => (
                  <button key={m.id} type="button" className="btn btn-secondary" disabled={busy}
                    onClick={() => void run("menu", () => apiClient.addOrderItem(order.id, { menuItemId: m.id }))}>
                    {menuItemLabel(m)}
                  </button>
                ))}
              </div>
              {errorIn("menu")}
            </section>
          )}

          {shown.custom && (
            <section className="food-card" data-area="custom">
              <h3 className="food-card-title">Своё блюдо</h3>
              <div className="food-dish-row">
                <input type="text" className="food-dish-name" aria-label="Своё блюдо" placeholder="Что" maxLength={FOOD_TEXT_MAX}
                  value={customName} disabled={busy} onChange={(e) => setCustomName(e.target.value)} />
                <input type="text" className="food-dish-price" aria-label="Цена, ₽" placeholder="₽" inputMode="numeric"
                  value={customPrice} disabled={busy} onChange={(e) => setCustomPrice(priceDigits(e.target.value))} />
              </div>
              <div className="food-buttons">
                <button type="button" className="btn btn-primary" disabled={busy || !customName.trim() || !customPrice}
                  onClick={() => void run("custom", async () => {
                    const next = await apiClient.addOrderItem(order.id, { name: customName.trim(), price: Number(customPrice) });
                    setCustomName("");
                    setCustomPrice("");
                    return next;
                  })}>
                  Добавить
                </button>
              </div>
              {errorIn("custom")}
            </section>
          )}

          {/* Вне блока «Своё блюдо»: у сбора без своих позиций тот блок не рисуется, а отказаться
              от участия должно быть можно всегда, пока приём открыт. */}
          {order.open && order.myItems.length === 0 && !order.declined && (
            <div className="food-buttons" data-area="decline">
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void run("mine", () => apiClient.declineOrder(order.id))}>🙅 Не буду</button>
            </div>
          )}
        </div>

        <div className="food-column">
          {order.people && (
            <section className="food-card" data-area="people">
              <h3 className="food-card-title">Что заказать</h3>
              {order.dishes.map((d) => <div key={`${d.name}-${d.price}`}>{itemLines([d])[0]}</div>)}
              <h3 className="food-card-title">Кто сколько</h3>
              {order.people.map((p) => (
                <div key={p.employeeId}>
                  {orderPersonBlock(p).map((line, i) => <div key={i} data-person-line className="food-person-line">{line}</div>)}
                </div>
              ))}
              <div className="food-total">Итого: {formatMoney(order.total)}</div>
            </section>
          )}

          {shown.payments && (
            <section className="food-card" data-area="payments">
              <h3 className="food-card-title">Кто сдал · {order.payment.paidCount} из {order.payment.total}</h3>
              {order.payment.rows!.map((r) => (
                <label key={r.employeeId} className="food-pay-row">
                  <input type="checkbox" checked={r.paid} disabled={busy}
                    onChange={(e) => void run("payments", () => apiClient.setOrderPaymentFor(order.id, r.employeeId, e.target.checked))} />
                  <span className="food-row-name">{r.displayName}{r.markedByAdmin ? FOOD_CASH_MARK : ""}</span>
                  <span>{formatMoney(r.amount)}</span>
                </label>
              ))}
              {order.payment.paidCount < order.payment.total && (
                <div className="food-buttons">
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void remind(order.id)}>⏰ Напомнить не сдавшим</button>
                </div>
              )}
              {remindResult && <div className="food-meta" role="status">{remindResult}</div>}
              {errorIn("payments")}
            </section>
          )}

          {shown.manage && (
            <section className="food-card" data-area="manage">
              <h3 className="food-card-title">Приём</h3>
              <div className="food-buttons">
                <ConfirmButton label="Закрыть приём" question={closeOrderQuestion(order)} confirmLabel="Закрыть" disabled={busy}
                  onConfirm={() => void run("manage", () => apiClient.closeOrder(order.id))} />
                <ConfirmButton label="Отменить заказ" question={cancelOrderQuestion(order)} confirmLabel="Отменить" disabled={busy}
                  onConfirm={() => void run("manage", () => apiClient.cancelOrder(order.id))} />
              </div>
              {errorIn("manage")}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
