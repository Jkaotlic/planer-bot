import { useEffect, useState } from "react";
import { Input, Textarea } from "@telegram-apps/telegram-ui";
import { formatMoney } from "@planer/shared";
import { apiClient, type PlaceView, type TeamAudience } from "../../api/client";
import { AudiencePicker } from "../../components/AudiencePicker";
import { ActionButton, Card } from "../../ui";

/**
 * Новый заказ еды. «На смене» по умолчанию — та же причина, что у опроса
 * (Задача 7): чаще всего заказывают тех, кто сегодня рядом, позвать всех —
 * один тап. Место — из уже заведённых в «Места и меню», либо «Без меню» для
 * разового заказа, где кнопок блюд не будет и все позиции добавляются своими.
 *
 * `onEditPlaces` — необязательный: ревью раунда 1 решило, что ссылка «🍴 Места
 * и меню» должна быть прямо тут, рядом с рядом кнопок места, а не только в
 * шапке списка «Заказы и опросы» — иначе человек без единого заведённого
 * места не видит, куда идти, до того как отменит форму.
 */
export function OrderForm({ onDone, onCancel, onEditPlaces }: { onDone(orderId: number): void; onCancel(): void; onEditPlaces?(): void }) {
  const [places, setPlaces] = useState<PlaceView[]>([]);
  // Отдельно от `places`: пустой массив — это и «ещё грузится», и «мест
  // правда нет», а подсказку «Мест пока нет» нельзя мигать на каждую загрузку.
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [payHint, setPayHint] = useState("");
  const [closesTime, setClosesTime] = useState("");
  const [audience, setAudience] = useState<TeamAudience>({ kind: "on_shift" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отчёт после отправки — та же причина, что в PollForm: `AudiencePicker`
  // уже показывает недостижимых ДО отправки, но точный ответ даёт только
  // сервер в самом ответе создания — состояние могло смениться гонкой.
  const [summary, setSummary] = useState<{ orderId: number; delivered: number; unreachable: string[] } | null>(null);

  useEffect(() => {
    let alive = true;
    // Отказ загрузки мест — не повод класть форму: «Без меню» всё равно
    // работает, а место можно завести потом через «Места и меню».
    apiClient.getFoodPlaces()
      .then((p) => { if (alive) setPlaces(p); })
      .catch(() => { if (alive) setPlaces([]); })
      .finally(() => { if (alive) setPlacesLoaded(true); });
    return () => { alive = false; };
  }, []);

  const ready = !(audience.kind === "picked" && audience.employeeIds.length === 0);
  const selectedPlace = places.find((p) => p.id === placeId) ?? null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.createOrder({
        placeId, note: note.trim() || null, payHint: payHint.trim() || null, closesTime: closesTime || null, audience,
      });
      if (result.unreachable.length > 0) setSummary({ orderId: result.order.id, delivered: result.delivered, unreachable: result.unreachable });
      else onDone(result.order.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить заказ");
    } finally {
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px var(--app-gutter) calc(24px + var(--app-inset-bottom))" }}>
        <h1 className="ui-screen__title">Заказ отправлен</h1>
        <div style={{ fontSize: "var(--app-text-body)", lineHeight: 1.45 }}>
          Отправлено: {summary.delivered}. Не дошло: {summary.unreachable.join(", ")}
        </div>
        <ActionButton kind="primary" onClick={() => onDone(summary.orderId)}>ОК</ActionButton>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px var(--app-gutter) calc(24px + var(--app-inset-bottom))" }}>
      <h1 className="ui-screen__title">Новый заказ</h1>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Место</div>
          {onEditPlaces && <ActionButton compact kind="quiet" onClick={onEditPlaces}>🍴 Места и меню</ActionButton>}
        </div>
        {/* Выбранное место — тонированная кнопка, остальные — без фона: `primary`
            здесь один и принадлежит «Разослать», иначе в форме две главные кнопки. */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 6 }}>
          <ActionButton compact kind={placeId === null ? "secondary" : "quiet"} aria-pressed={placeId === null} disabled={busy} onClick={() => setPlaceId(null)}>Без меню</ActionButton>
          {places.map((p) => (
            <ActionButton key={p.id} compact kind={placeId === p.id ? "secondary" : "quiet"} aria-pressed={placeId === p.id} disabled={busy} onClick={() => setPlaceId(p.id)}>{p.name}</ActionButton>
          ))}
        </div>
        {placesLoaded && places.length === 0 && (
          <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", paddingTop: 6 }}>
            Мест пока нет — добавь через «🍴 Места и меню» или заказывай без меню.
          </div>
        )}
        {/* Меню выбранного места серым — чтобы было видно, что уйдёт
            кнопками в заказ, ещё до того, как заказ заведён. */}
        {selectedPlace && (
          <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", paddingTop: 6 }}>
            {selectedPlace.menu.length > 0
              ? selectedPlace.menu.map((m) => `${m.name} ${formatMoney(m.price)}`).join(" · ")
              : "Меню пусто"}
          </div>
        )}
      </div>
      {/* Поля `Input`/`Textarea` красят свой фон прямоугольником без скругления;
          в карточке он сливается с её цветом, и форма — одного вида с остальными. */}
      <Card>
        <Textarea header="Комментарий (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        <Input header="Куда сдавать (необязательно)" name="pay-hint" value={payHint} onChange={(e) => setPayHint(e.target.value)} disabled={busy} />
        <Input header="Приём до (необязательно)" type="time" value={closesTime} onChange={(e) => setClosesTime(e.target.value)} disabled={busy} />
      </Card>
      <AudiencePicker value={audience} onChange={setAudience} disabled={busy} />
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton kind="primary" disabled={!ready || busy} loading={busy} onClick={submit}>Разослать</ActionButton>
        <ActionButton kind="quiet" disabled={busy} onClick={onCancel}>Отмена</ActionButton>
      </div>
    </div>
  );
}
