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
  const [order, setOrder] = useState<OrderView | null | "error">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");

  useEffect(() => {
    let alive = true;
    apiClient.getOrder(orderId).then((o) => { if (alive) setOrder(o); }).catch(() => { if (alive) setOrder("error"); });
    return () => { alive = false; };
  }, [orderId]);

  async function run(action: () => Promise<OrderView>) {
    setBusy(true);
    setError(null);
    try { setOrder(await action()); }
    catch (err) { setError(err instanceof Error ? err.message : "Не получилось"); }
    finally { setBusy(false); }
  }

  if (order === null) return <ScreenScroll><div style={{ color: "var(--tgui--hint_color)" }}>Загружаю заказ…</div></ScreenScroll>;
  if (order === "error") return <ScreenScroll><div>Заказ не найден или недоступен.</div><Button size="s" mode="plain" onClick={onBack}>Назад</Button></ScreenScroll>;

  const status = order.cancelled ? "отменён" : order.open ? (order.closes ?? "приём идёт") : "приём закрыт";
  return (
    <ScreenScroll>
      <Button size="s" mode="plain" onClick={onBack}>‹ Назад</Button>
      <Title level="2" weight="2">🍱 {order.placeName ?? "Заказ без меню"}</Title>
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
        Собирает {order.creatorName} · {status} · ответили {order.respondedCount} из {order.recipientCount}
      </div>
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
                  <Button size="s" mode="gray" disabled={busy || item.qty >= 20} onClick={() => run(() => apiClient.setOrderItemQty(order.id, item.id, item.qty + 1))}>＋</Button>
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
      </CardStack>

      {order.canManage && order.open && (
        <div style={{ display: "flex", gap: 8, padding: "8px 0" }}>
          <ConfirmButton label="Закрыть приём" question="Закрыть приём и разослать «сдай»?" confirmLabel="Закрыть"
            onConfirm={() => run(() => apiClient.closeOrder(order.id))} disabled={busy} />
          <ConfirmButton label="Отменить заказ" question="Отменить заказ?" confirmLabel="Отменить"
            onConfirm={() => run(() => apiClient.cancelOrder(order.id))} disabled={busy} />
        </div>
      )}
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>}
    </ScreenScroll>
  );
}
