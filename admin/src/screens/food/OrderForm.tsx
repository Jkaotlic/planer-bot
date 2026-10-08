import { useEffect, useState } from "react";
import { FOOD_CLOSE_HORIZON_DAYS, FOOD_NO_PLACES_HINT, FOOD_NOTE_MAX, FOOD_TEXT_MAX, addDaysIso, audienceReady, menuPreview, sendReportText, type FoodSendReport, type TeamAudience } from "@planer/shared";
import { apiClient, type PlaceView } from "../../api/client";
import { AudiencePicker } from "./AudiencePicker";
import { routeAuthError, useAuthRequired } from "../../auth-required";
import { failureText } from "./food-errors";
import { useTeamToday } from "../../lib/team-today";

/**
 * Новый заказ еды — как в мини-аппе (`miniapp/src/screens/food/OrderForm.tsx`).
 * «На смене» по умолчанию: чаще всего заказывают тех, кто сегодня рядом. Место —
 * из «Мест и меню» или «Без меню», тогда все позиции добавляются своими.
 */
export function OrderForm({ onDone, onCancel, onEditPlaces }: {
  onDone(orderId: number): void;
  onCancel(): void;
  onEditPlaces?(): void;
}) {
  const onAuthRequired = useAuthRequired();
  const [places, setPlaces] = useState<PlaceView[]>([]);
  // Отдельно от `places`: пустой массив — это и «ещё грузится», и «мест правда нет»,
  // а подсказку «Мест пока нет» нельзя мигать на каждую загрузку.
  const [placesLoaded, setPlacesLoaded] = useState(false);
  const [placeId, setPlaceId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [payHint, setPayHint] = useState("");
  const [title, setTitle] = useState("");
  // Что человек отметил для места; «Без меню» перекрывает это принудительно (см. `allowCustom`).
  const [allowCustomPick, setAllowCustomPick] = useState(true);
  const [closesDate, setClosesDate] = useState("");
  const [closesTime, setClosesTime] = useState("");
  // Командная дата, не часы браузера: граница дня не зависит от пояса машины.
  const today = useTeamToday();
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
      .catch((err: unknown) => { if (!routeAuthError(err, onAuthRequired) && alive) setPlaces([]); })
      .finally(() => { if (alive) setPlacesLoaded(true); });
    return () => { alive = false; };
  }, []);

  const selected = places.find((p) => p.id === placeId) ?? null;
  // Без меню и без своих позиций заказывать нечего — сервер такое отклоняет (400), поэтому
  // форма не даёт его собрать, а не показывает отказ после нажатия.
  const allowCustom = placeId === null ? true : allowCustomPick;
  // Дата без времени срока не задаёт: молча выбрать «00:00» значило бы закрыть сбор до начала.
  const dateWithoutTime = closesDate !== "" && closesTime === "";
  // Без даты шлём только время (`closesTime`): «сегодня» достраивает сервер по командным
  // часам. Своё `today` здесь — с момента открытия формы, и после полуночи оно вчерашнее.
  const closesAt = closesTime && closesDate ? `${closesDate}T${closesTime}` : null;
  const legacyTime = closesTime && !closesDate ? { closesTime } : {};

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiClient.createOrder({
        placeId, title: title.trim() || null, allowCustom, note: note.trim() || null, payHint: payHint.trim() || null, closesAt, ...legacyTime, audience,
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
        Название (необязательно)
        <input type="text" aria-label="Название" placeholder="Например: Икра, доставка 09.10" maxLength={FOOD_TEXT_MAX} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="food-check">
        <input type="checkbox" aria-label="Можно добавлять свои позиции" checked={allowCustom} disabled={busy || placeId === null}
          onChange={(e) => setAllowCustomPick(e.target.checked)} />
        <span>Можно добавлять свои позиции</span>
      </label>
      {placeId === null && <div className="food-meta">Без меню позиции — только свои.</div>}
      <label className="birthday-label">
        Комментарий (необязательно)
        <textarea rows={2} aria-label="Комментарий" maxLength={FOOD_NOTE_MAX} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="birthday-label">
        Куда сдавать (необязательно)
        <input type="text" name="pay-hint" aria-label="Куда сдавать" maxLength={FOOD_NOTE_MAX} value={payHint} disabled={busy} onChange={(e) => setPayHint(e.target.value)} />
      </label>
      <div className="food-when">
        <label className="birthday-label">
          Дата (необязательно)
          <input type="date" aria-label="Дата приёма" min={today} max={addDaysIso(today, FOOD_CLOSE_HORIZON_DAYS)} value={closesDate} disabled={busy}
            onChange={(e) => setClosesDate(e.target.value)} />
        </label>
        <label className="birthday-label">
          Приём до (необязательно)
          <input type="time" aria-label="Приём до" value={closesTime} disabled={busy} onChange={(e) => setClosesTime(e.target.value)} />
        </label>
      </div>
      {dateWithoutTime && <div className="food-meta" role="status">Укажи и время — дата без времени срок не задаёт.</div>}
      <AudiencePicker value={audience} onChange={setAudience} disabled={busy} />
      {error && <div className="employees-error" role="alert">{error}</div>}
      <div className="food-buttons">
        <button type="button" className="btn btn-primary" disabled={!audienceReady(audience) || dateWithoutTime || busy} onClick={() => void submit()}>
          {busy ? "Отправляю…" : "Разослать"}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}
