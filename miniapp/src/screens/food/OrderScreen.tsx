import { useEffect, useState } from "react";
import { Input } from "@telegram-apps/telegram-ui";
import {
  FOOD_QTY_MAX, cancelOrderQuestion, closeOrderQuestion, formatMoney, itemLines, menuItemLabel, myOrderPayment,
  orderPersonLine, orderStatusLabel, priceDigits, remindResultText,
} from "@planer/shared";
import { apiClient, type OrderView } from "../../api/client";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ActionButton, Card, Group, Hint } from "../../ui";

/**
 * Один заказ. Участнику — меню кнопками, своё блюдо, свои позиции с
 * количеством. Запускающему сверх того — сводка, «кто сколько» и закрытие.
 * Сюда же ведёт «✍️ Своё блюдо» из письма бота (`?screen=orders&order=<id>`).
 */
export function OrderScreen({ orderId, onBack }: { orderId: number; onBack(): void }) {
  const [order, setOrder] = useState<OrderView | null>(null);
  // Отдельно от `order`: сообщение сервера («заказ не найден», офлайн) не
  // заменяется общей заглушкой, а «Повторить» — та же кнопка, что у списка
  // («Заказы и опросы») и у списка мест — нужна тут по той же причине: тап
  // может провалиться из-за рестарта сервера при выкладке, а не потому, что
  // заказа правда нет.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [remindResult, setRemindResult] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setOrder(null);
    setLoadError(null);
    apiClient.getOrder(orderId)
      .then((o) => { if (alive) setOrder(o); })
      .catch((err) => { if (alive) setLoadError(err instanceof Error ? err.message : "Не удалось загрузить заказ."); });
    return () => { alive = false; };
  }, [orderId, loadAttempt]);

  async function run(action: () => Promise<OrderView>) {
    setBusy(true);
    setError(null);
    setRemindResult(null);
    try {
      setOrder(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
      // Гонка тика и ручного действия (Review Focus №1, как в `PollCard`):
      // сервер мог закрыть заказ между рендером и тапом — перечитываем его,
      // чтобы погашенные кнопки исчезли сами, а не висели активными до
      // следующего открытия экрана. Отказ перечитывания не страшен: старое
      // состояние экрана остаётся, а текст ошибки уже показан.
      try {
        const fresh = await apiClient.getOrder(orderId);
        if (fresh) setOrder(fresh);
      } catch {
        /* оставляем прежний `order` — хотя бы кнопки и текст ошибки видны */
      }
    } finally {
      setBusy(false);
    }
  }

  /** Дожим отдаёт не заказ, а сколько дошло/сколько ждём — «Кто сдал»
   *  перечитывается сама по себе позже (тик или открытие экрана заново);
   *  здесь только строка результата. Отказ и гонка с тиком — тот же приём,
   *  что у `run`. */
  async function runRemind(id: number) {
    setBusy(true);
    setError(null);
    setRemindResult(null);
    try {
      setRemindResult(remindResultText(await apiClient.remindOrderUnpaid(id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
      try {
        const fresh = await apiClient.getOrder(orderId);
        if (fresh) setOrder(fresh);
      } catch {
        /* оставляем прежний `order` — хотя бы кнопки и текст ошибки видны */
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="ui-page">
        <div>{loadError}</div>
        <div style={{ display: "flex", gap: 8, paddingTop: 8 }}>
          <ActionButton compact kind="quiet" onClick={onBack}>‹ Назад</ActionButton>
          <ActionButton compact kind="quiet" onClick={() => setLoadAttempt((n) => n + 1)}>Повторить</ActionButton>
        </div>
      </div>
    );
  }
  if (order === null) return <div className="ui-page"><Hint>Загружаю заказ…</Hint></div>;

  const status = orderStatusLabel(order);
  const pay = myOrderPayment(order);
  return (
    <div className="ui-page">
      <ActionButton compact kind="quiet" onClick={onBack}>‹ Назад</ActionButton>
      <h1 className="ui-screen__title">🍱 {order.placeName ?? "Заказ без меню"}</h1>
      {/* Нижний отступ: `ui-page` не ставит зазор между детьми, и строка статуса липла к первой карточке. */}
      <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", marginBottom: 8 }}>
        Собирает {order.creatorName} · {status} · ответили {order.respondedCount} из {order.recipientCount}
      </div>
      {/* Наверху, а не под кнопками управления: отказ тапа по блюду меню
          (например, «Приём закрыт.» — гонка с закрытием) должен быть виден
          сразу, а не после прокрутки всех карточек вниз. */}
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>}
      {order.note && <div style={{ fontSize: "var(--app-text-meta)" }}>{order.note}</div>}
      {order.payHint && <div style={{ fontSize: "var(--app-text-meta)" }}>Куда сдавать: {order.payHint}</div>}

      <Group>
        <Card>
          <div style={{ fontWeight: 600 }}>Твой заказ</div>
          {order.myItems.length === 0 && <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>{order.declined ? "Ты не заказываешь." : "Пока пусто."}</div>}
          {order.myItems.map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ flex: 1 }}>{itemLines([item])[0]}</span>
              {order.open && (
                <>
                  <ActionButton compact disabled={busy || item.qty <= 1} onClick={() => run(() => apiClient.setOrderItemQty(order.id, item.id, item.qty - 1))}>−</ActionButton>
                  <ActionButton compact disabled={busy || item.qty >= FOOD_QTY_MAX} onClick={() => run(() => apiClient.setOrderItemQty(order.id, item.id, item.qty + 1))}>+</ActionButton>
                  <ActionButton compact kind="quiet" disabled={busy} onClick={() => run(() => apiClient.removeOrderItem(order.id, item.id))}>✕</ActionButton>
                </>
              )}
            </div>
          ))}
          {order.myTotal > 0 && <div style={{ fontWeight: 600 }}>Итого: {formatMoney(order.myTotal)}</div>}
          {pay.oweLine && <div>{pay.oweLine}</div>}
          {/* Отметка — не тумблер: «Ты отметился ✓» снимала «сдал» одним тапом, и промах
              пальцем молча стирал его. Снять — отдельно и с подтверждением, как в боте. */}
          {pay.mark === "can-mark" && (
            <ActionButton compact disabled={busy}
              onClick={() => run(() => apiClient.setOrderPaid(order.id, true))}>
              💸 Я сдал
            </ActionButton>
          )}
          {pay.mark === "marked" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span>✓ Ты отметился</span>
              <ConfirmButton label="Снять отметку" question="Снять отметку о сдаче?" confirmLabel="Снять" mode="plain"
                onConfirm={() => run(() => apiClient.setOrderPaid(order.id, false))} disabled={busy} />
            </div>
          )}
        </Card>

        {order.open && order.menu.length > 0 && (
          <Card>
            <div style={{ fontWeight: 600 }}>Меню</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {order.menu.map((m) => (
                <ActionButton key={m.id} compact disabled={busy}
                  onClick={() => run(() => apiClient.addOrderItem(order.id, { menuItemId: m.id }))}>{menuItemLabel(m)}</ActionButton>
              ))}
            </div>
          </Card>
        )}

        {order.open && (
          <Card>
            <div style={{ fontWeight: 600 }}>Своё блюдо</div>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input name="custom-name" placeholder="Что" value={customName} onChange={(e) => setCustomName(e.target.value)} disabled={busy} />
              </div>
              <div style={{ width: 90, flex: "none" }}>
                <Input name="custom-price" placeholder="₽" inputMode="numeric" value={customPrice}
                  onChange={(e) => setCustomPrice(priceDigits(e.target.value))} disabled={busy} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton compact kind="primary" disabled={busy || !customName.trim() || !customPrice}
                onClick={() => run(async () => {
                  const next = await apiClient.addOrderItem(order.id, { name: customName.trim(), price: Number(customPrice) });
                  setCustomName(""); setCustomPrice("");
                  return next;
                })}>Добавить</ActionButton>
              {order.myItems.length === 0 && !order.declined && (
                <ActionButton compact kind="quiet" disabled={busy} onClick={() => run(() => apiClient.declineOrder(order.id))}>🙅 Не буду</ActionButton>
              )}
            </div>
          </Card>
        )}

        {order.people && (
          <Card>
            <div style={{ fontWeight: 600 }}>Что заказать</div>
            {order.dishes.map((d) => <div key={`${d.name}-${d.price}`}>{itemLines([d])[0]}</div>)}
            <div style={{ fontWeight: 600, marginTop: 6 }}>Кто сколько</div>
            {order.people.map((p) => (
              <div key={p.employeeId}>{orderPersonLine(p)}</div>
            ))}
            <div style={{ fontWeight: 600 }}>Итого: {formatMoney(order.total)}</div>
          </Card>
        )}

        {order.closed && order.payment.rows && order.payment.total > 0 && (
          <Card>
            <div style={{ fontWeight: 600 }}>Кто сдал · {order.payment.paidCount} из {order.payment.total}</div>
            {order.payment.rows.map((r) => (
              <label key={r.employeeId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={r.paid} disabled={busy}
                  onChange={(e) => run(() => apiClient.setOrderPaymentFor(order.id, r.employeeId, e.target.checked))} />
                <span style={{ flex: 1 }}>{r.displayName}{r.markedByAdmin ? " · наличкой" : ""}</span>
                <span>{formatMoney(r.amount)}</span>
              </label>
            ))}
            {order.payment.paidCount < order.payment.total && (
              <ActionButton compact disabled={busy} onClick={() => runRemind(order.id)}>⏰ Напомнить не сдавшим</ActionButton>
            )}
            {remindResult && <div style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>{remindResult}</div>}
          </Card>
        )}
      </Group>

      {order.canManage && order.open && (
        <div style={{ display: "flex", gap: 8, padding: "8px 0" }}>
          <ConfirmButton label="Закрыть приём" question={closeOrderQuestion(order)} confirmLabel="Закрыть"
            onConfirm={() => run(() => apiClient.closeOrder(order.id))} disabled={busy} />
          <ConfirmButton label="Отменить заказ" question={cancelOrderQuestion(order)} confirmLabel="Отменить"
            onConfirm={() => run(() => apiClient.cancelOrder(order.id))} disabled={busy} />
        </div>
      )}
    </div>
  );
}
