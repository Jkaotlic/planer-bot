import { useEffect, useState } from "react";
import { FOOD_NO_PLACES_HINT, FOOD_NOTE_MAX, audienceReady, menuPreview, sendReportText, type FoodSendReport, type TeamAudience } from "@planer/shared";
import { apiClient, type PlaceView } from "../../api/client";
import { AudiencePicker } from "./AudiencePicker";
import { failureText } from "./food-errors";

/**
 * Новый заказ еды — как в мини-аппе (`miniapp/src/screens/food/OrderForm.tsx`).
 * «На смене» по умолчанию: чаще всего заказывают тех, кто сегодня рядом. Место —
 * из «Мест и меню» или «Без меню», тогда все позиции добавляются своими.
 */
export function OrderForm({ onDone, onCancel, onEditPlaces, onAuthRequired }: {
  onDone(orderId: number): void;
  onCancel(): void;
  onEditPlaces?(): void;
  onAuthRequired(): void;
}) {
  const [places, setPlaces] = useState<PlaceView[]>([]);
  // Отдельно от `places`: пустой массив — это и «ещё грузится», и «мест правда нет»,
  // а подсказку «Мест пока нет» нельзя мигать на каждую загрузку.
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [payHint, setPayHint] = useState("");
  const [closesTime, setClosesTime] = useState("");
  const [audience, setAudience] = useState<TeamAudience>({ kind: "on_shift" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Отчёт после отправки: выбор адресатов показывает недостижимых ДО отправки, но
  // точный ответ даёт только сервер — состояние могло смениться гонкой.
  const [summary, setSummary] = useState<(FoodSendReport & { orderId: number }) | null>(null);

  useEffect(() => {
    let alive = true;
    // Отказ загрузки мест — не повод класть форму: «Без меню» работает и так.
    apiClient.getFoodPlaces()
      .then((list) => { if (alive) setPlaces(list); })
      .catch(() => { if (alive) setPlaces([]); })
      .finally(() => { if (alive) setPlacesLoaded(true); });
    return () => { alive = false; };
  }, []);

  const selected = places.find((p) => p.id === placeId) ?? null;

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
      setError(failureText(err, "Не удалось отправить заказ", onAuthRequired));
    } finally {
      setBusy(false);
    }
  }

  if (summary) {
    return (
      <div className="employees-screen employees-screen-form food-form">
        <h2 className="employees-title">Заказ отправлен</h2>
        <div className="food-note">{sendReportText(summary)}</div>
        <div className="food-buttons">
          <button type="button" className="btn btn-primary" onClick={() => onDone(summary.orderId)}>ОК</button>
        </div>
      </div>
    );
  }

  return (
    <div className="employees-screen employees-screen-form food-form">
      <h2 className="employees-title">Новый заказ</h2>
      <div className="food-form">
        <div className="food-row">
          <span className="birthday-label food-row-name">Место</span>
          {onEditPlaces && <button type="button" className="btn btn-quiet btn-compact" onClick={onEditPlaces}>🍴 Места и меню</button>}
        </div>
        <div className="food-buttons" role="group" aria-label="Место">
          <button type="button" className="btn btn-secondary btn-compact food-chip" aria-pressed={placeId === null} disabled={busy} onClick={() => setPlaceId(null)}>Без меню</button>
          {places.map((p) => (
            <button key={p.id} type="button" className="btn btn-secondary btn-compact food-chip" aria-pressed={placeId === p.id} disabled={busy} onClick={() => setPlaceId(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        {placesLoaded && places.length === 0 && (
          <div className="food-meta">{FOOD_NO_PLACES_HINT}</div>
        )}
        {/* Меню выбранного места — чтобы было видно, что уйдёт кнопками, ещё до заказа. */}
        {selected && <div className="food-meta">{menuPreview(selected.menu)}</div>}
      </div>
      <label className="birthday-label">
        Комментарий (необязательно)
        <textarea rows={2} aria-label="Комментарий" maxLength={FOOD_NOTE_MAX} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="birthday-label">
        Куда сдавать (необязательно)
        <input type="text" name="pay-hint" aria-label="Куда сдавать" maxLength={FOOD_NOTE_MAX} value={payHint} disabled={busy} onChange={(e) => setPayHint(e.target.value)} />
      </label>
      <label className="birthday-label">
        Приём до (необязательно)
        <input type="time" className="food-time" aria-label="Приём до" value={closesTime} disabled={busy} onChange={(e) => setClosesTime(e.target.value)} />
      </label>
      <AudiencePicker value={audience} onChange={setAudience} disabled={busy} onAuthRequired={onAuthRequired} />
      {error && <div className="employees-error" role="alert">{error}</div>}
      <div className="food-buttons">
        <button type="button" className="btn btn-primary" disabled={!audienceReady(audience) || busy} onClick={() => void submit()}>
          {busy ? "Отправляю…" : "Разослать"}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}
