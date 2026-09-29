import { useEffect, useState } from "react";
import { Button, Input, Title } from "@telegram-apps/telegram-ui";
import { formatMoney, itemLines } from "@planer/shared";
import { apiClient, type OrderView } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ConfirmButton } from "../../components/ConfirmButton";
import { ScreenScroll } from "../../components/ScreenScroll";

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

  /** Дожим отдаёт не заказ, а число дошедших — «Кто сдал» перечитывается сама
   *  по себе позже (тик или открытие экрана заново); здесь только строка
   *  результата. Отказ и гонка с тиком — тот же приём, что у `run`. */
  async function runRemind(id: number) {
    setBusy(true);
    setError(null);
    try {
      const { delivered } = await apiClient.remindOrderUnpaid(id);
      setRemindResult(`Напомнил: ${delivered}`);
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
      <ScreenScroll>
        <div>{loadError}</div>
        <div style={{ display: "flex", gap: 8, paddingTop: 8 }}>
          <Button size="s" mode="plain" onClick={onBack}>‹ Назад</Button>
          <Button size="s" mode="plain" onClick={() => setLoadAttempt((n) => n + 1)}>Повторить</Button>
        </div>
      </ScreenScroll>
    );
  }
  if (order === null) return <ScreenScroll><div style={{ color: "var(--tgui--hint_color)" }}>Загружаю заказ…</div></ScreenScroll>;

  const status = order.cancelled ? "отменён" : order.open ? (order.closes ?? "приём идёт") : "приём закрыт";
  return (
    <ScreenScroll>
      <Button size="s" mode="plain" onClick={onBack}>‹ Назад</Button>
      <Title level="2" weight="2">🍱 {order.placeName ?? "Заказ без меню"}</Title>
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
        Собирает {order.creatorName} · {status} · ответили {order.respondedCount} из {order.recipientCount}
      </div>
      {/* Наверху, а не под кнопками управления: отказ тапа по блюду меню
          (например, «Приём закрыт.» — гонка с закрытием) должен быть виден
          сразу, а не после прокрутки всех карточек вниз. */}
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>}
      {order.note && <div style={{ fontSize: 13.5 }}>{order.note}</div>}
      {order.payHint && <div style={{ fontSize: 13.5 }}>Куда сдавать: {order.payHint}</div>}

      <CardStack>
        <CardShell>
          <div style={{ fontWeight: 600 }}>Твой заказ</div>
          {order.myItems.length === 0 && <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>{order.declined ? "Ты не заказываешь." : "Пока пусто."}</div>}
          {order.myItems.map((item) => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ flex: 1 }}>{itemLines([item])[0]}</span>
              {order.open && (
                <>
                  <Button size="s" mode="gray" disabled={busy || item.qty <= 1} onClick={() => run(() => apiClient.setOrderItemQty(order.id, item.id, item.qty - 1))}>−</Button>
                  <Button size="s" mode="gray" disabled={busy || item.qty >= 20} onClick={() => run(() => apiClient.setOrderItemQty(order.id, item.id, item.qty + 1))}>+</Button>
                  <Button size="s" mode="plain" disabled={busy} onClick={() => run(() => apiClient.removeOrderItem(order.id, item.id))}>✕</Button>
                </>
              )}
            </div>
          ))}
          {order.myTotal > 0 && <div style={{ fontWeight: 600 }}>Итого: {formatMoney(order.myTotal)}</div>}
          {/* Дательный падеж от одного `displayName` не построить — та же причина,
              что у `collectionMessage`: «сбор на Пётр Иванов» уже ловили на ревью. */}
          {!order.open && !order.cancelled && order.myTotal > 0 && !order.isCreator && (
            <div>Сдать: {formatMoney(order.myTotal)} — {order.creatorName}</div>
          )}
          {order.closed && !order.isCreator && order.myTotal > 0 && (
            <Button size="s" mode={order.payment.myPaid ? "gray" : "bezeled"} disabled={busy}
              onClick={() => run(() => apiClient.setOrderPaid(order.id, !order.payment.myPaid))}>
              {order.payment.myPaid ? "Ты отметился ✓" : "💸 Я сдал"}
            </Button>
          )}
        </CardShell>

        {order.open && order.menu.length > 0 && (
          <CardShell>
            <div style={{ fontWeight: 600 }}>Меню</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {order.menu.map((m) => (
                <Button key={m.id} size="s" mode="bezeled" disabled={busy}
                  onClick={() => run(() => apiClient.addOrderItem(order.id, { menuItemId: m.id }))}>{`${m.name} · ${formatMoney(m.price)}`}</Button>
              ))}
            </div>
          </CardShell>
        )}

        {order.open && (
          <CardShell>
            <div style={{ fontWeight: 600 }}>Своё блюдо</div>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input name="custom-name" placeholder="Что" value={customName} onChange={(e) => setCustomName(e.target.value)} disabled={busy} />
              </div>
              <div style={{ width: 90, flex: "none" }}>
                <Input name="custom-price" placeholder="₽" inputMode="numeric" value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value.replace(/\D/g, ""))} disabled={busy} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button size="s" mode="filled" disabled={busy || !customName.trim() || !customPrice}
                onClick={() => run(async () => {
                  const next = await apiClient.addOrderItem(order.id, { name: customName.trim(), price: Number(customPrice) });
                  setCustomName(""); setCustomPrice("");
                  return next;
                })}>Добавить</Button>
              {order.myItems.length === 0 && !order.declined && (
                <Button size="s" mode="plain" disabled={busy} onClick={() => run(() => apiClient.declineOrder(order.id))}>🙅 Не буду</Button>
              )}
            </div>
          </CardShell>
        )}

        {order.people && (
          <CardShell>
            <div style={{ fontWeight: 600 }}>Что заказать</div>
            {order.dishes.map((d) => <div key={`${d.name}-${d.price}`}>{itemLines([d])[0]}</div>)}
            <div style={{ fontWeight: 600, marginTop: 6 }}>Кто сколько</div>
            {order.people.map((p) => (
              <div key={p.employeeId}>{p.displayName} — {p.declined ? "не будет" : p.amount > 0 ? formatMoney(p.amount) : "не ответил(а)"}</div>
            ))}
            <div style={{ fontWeight: 600 }}>Итого: {formatMoney(order.total)}</div>
          </CardShell>
        )}

        {order.closed && order.payment.rows && (
          <CardShell>
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
              <Button size="s" mode="bezeled" disabled={busy} onClick={() => runRemind(order.id)}>⏰ Напомнить не сдавшим</Button>
            )}
            {remindResult && <div style={{ fontSize: 13, color: "var(--tgui--hint_color)" }}>{remindResult}</div>}
          </CardShell>
        )}
      </CardStack>

      {order.canManage && order.open && (
        <div style={{ display: "flex", gap: 8, padding: "8px 0" }}>
          <ConfirmButton label="Закрыть приём" question="Закрыть приём и разослать «сдай»?" confirmLabel="Закрыть"
            onConfirm={() => run(() => apiClient.closeOrder(order.id))} disabled={busy} />
          <ConfirmButton label="Отменить заказ" question="Отменить заказ?" confirmLabel="Отменить"
            onConfirm={() => run(() => apiClient.cancelOrder(order.id))} disabled={busy} />
        </div>
      )}
    </ScreenScroll>
  );
}
