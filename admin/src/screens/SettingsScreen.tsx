import { useEffect, useState } from "react";
import { calendarFrom, dayOffLabel, formatAuditMoment, isDayOff, validateReminderHour } from "@planer/shared";
import { apiClient, AuthRequiredError, type AdminSettings, type CalendarDayDto, type SwapLockResult } from "../api/client";
import { withNotifyNotice } from "../lib/notify-text";

/**
 * «Настройки»: тумблер замка обменов, час, в который уходят напоминания, и
 * праздники (`HolidaysCard` ниже).
 *
 * Раньше — только тумблер — общий замок обменов сменами. Он пишет сразу
 * всей команде и отменяет чужие незакрытые заявки, поэтому первое нажатие
 * только «взводит» подтверждение (`confirming`), а отправляет — второе. Тот же
 * узор, что у кнопки рассылки на «Сборах» (`CollectionsScreen.tsx`).
 *
 * Ошибка сохранения рисуется рядом с тумблером, а не вместо него: этот экран
 * не должен превращаться в тупик без F5, как уже дважды случалось в проекте.
 */
export function SettingsScreen() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SwapLockResult | null>(null);
  const [hour, setHour] = useState<string | null>(null);
  const [hourError, setHourError] = useState<string | null>(null);
  const [hourSaved, setHourSaved] = useState(false);
  const [savingHour, setSavingHour] = useState(false);

  async function reload() {
    try {
      const next = await apiClient.getSettings();
      setSettings(next);
      // Поле берёт серверное значение только пока его не начали править: иначе
      // перечитывание после соседнего тумблера стёрло бы набранное.
      setHour((current) => current ?? next.reminderHour);
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Не удалось загрузить настройки");
    }
  }

  useEffect(() => {
    void reload();
    // Загружается один раз; тумблер ниже перечитывает состояние сам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error && !settings) return <div className="employees-error">{error}</div>;
  if (!settings) return <div className="employees-empty">Загрузка…</div>;

  const locked = settings.swapsLocked;
  const actionLabel = locked ? "Открыть обмены" : "Закрыть обмены";
  const confirmLabel = locked ? "Да, открыть" : "Да, закрыть";
  const whoLabel =
    settings.swapsLockUpdatedAt === null
      ? "Ни разу не меняли"
      : `${locked ? "Закрыл" : "Открыл"} ${settings.swapsLockUpdatedBy ?? "неизвестно кто"} · ${formatAuditMoment(settings.swapsLockUpdatedAt)}`;

  async function handleConfirm() {
    setSaving(true);
    setError(null);
    try {
      const outcome = await apiClient.setSwapsLock(!locked);
      setConfirming(false);
      setResult(outcome);
      // reload() ловит свои ошибки сам — она не может провалить этот try.
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить настройку");
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleHour() {
    const value = hour ?? settings!.reminderHour;
    try {
      validateReminderHour(value);
    } catch (err) {
      setHourError(err instanceof Error ? err.message : "Неверный час");
      return;
    }
    setSavingHour(true);
    setHourError(null);
    try {
      await apiClient.setReminderHour(value);
      setHourSaved(true);
      await reload();
    } catch (err) {
      setHourError(err instanceof Error ? err.message : "Не удалось сохранить час");
    } finally {
      setSavingHour(false);
    }
  }

  const resultLine = result
    ? withNotifyNotice(
        result.locked ? `Обмены закрыты. Отменено заявок: ${result.cancelled}.` : "Обмены открыты.",
        result,
      )
    : null;

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Настройки</h2>
      </div>

      <p className="settings-intro">
        Закрытые обмены отменяют все неотвеченные заявки и пишут об этом всей команде.
      </p>

      {error && <div className="employees-error">{error}</div>}
      {resultLine && <div className="settings-result">{resultLine}</div>}

      <div className="settings-card">
        <div className="settings-state">Обмены смен — {locked ? "Закрыты" : "Открыты"}</div>
        <div className="settings-who">{whoLabel}</div>

        {confirming ? (
          <div className="settings-confirm">
            <span>
              {locked
                ? "Открыть обмены обратно?"
                : "Закрыть обмены? Незакрытые заявки отменятся, и об этом напишут всей команде."}
            </span>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void handleConfirm()}>
              {saving ? "Отправляю…" : confirmLabel}
            </button>
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setConfirming(false)}>
              Отмена
            </button>
          </div>
        ) : (
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => {
                setResult(null);
                setError(null);
                setConfirming(true);
              }}
            >
              {actionLabel}
            </button>
          </div>
        )}
      </div>

      {/* Час рассылки. Проверка та же, что на сервере (`validateReminderHour`):
          админ должен узнать про запрет до отправки, а не по отказу. */}
      <div className="settings-card">
        <div className="settings-state">Напоминания о завтрашней смене</div>
        <div className="settings-who">
          {settings.reminderHourUpdatedBy === null
            ? "Час ни разу не меняли"
            : `Поставил ${settings.reminderHourUpdatedBy}`}
        </div>
        <label className="settings-reminder-row">
          Уходят накануне в
          <input
            type="time"
            className="settings-reminder-hour"
            value={hour ?? settings.reminderHour}
            disabled={savingHour}
            onChange={(e) => {
              setHour(e.target.value);
              setHourError(null);
              setHourSaved(false);
            }}
          />
        </label>
        <span className="settings-reminder-note">
          Проверяется раз в пять минут, поэтому уходит первым тиком после этого времени.
        </span>
        {hourError && <div className="employees-error">{hourError}</div>}
        {hourSaved && <div className="settings-result">Час сохранён.</div>}
        <div className="settings-actions">
          <button type="button" className="btn btn-primary" disabled={savingHour} onClick={() => void handleHour()}>
            {savingHour ? "Сохраняю…" : "Сохранить час"}
          </button>
        </div>
      </div>

      <HolidaysCard settings={settings} onChanged={reload} />
    </div>
  );
}

/**
 * «Праздники»: рычаг автозагрузки, что уже загружено, «Обновить сейчас» и
 * ручная отметка одного дня. Поведение и тексты — из мини-аппа
 * (`AdminSettings.tsx` и отметка дня в `AdminScheduleScreen.tsx`).
 *
 * Отметка дня здесь, а не в шапке сетки, как в мини-аппе: у консоли в шапке
 * семь колонок, и три кнопки на каждую раздвинули бы сетку ради действия,
 * которое делают несколько раз в год. Цена — день выбирают полем даты, а не
 * тапом по дню; зато после отметки сетка красит его сама (тот же календарь).
 *
 * Год, которого нет в ответе, подписан «ещё не опубликован»: 404 источника —
 * это «Правительство пока не утвердило», и пустота читалась бы как сбой.
 */
function HolidaysCard({ settings, onChanged }: { settings: AdminSettings; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState("");
  // `undefined` — день ещё не прочитан; пустой массив — прочитан, отметок нет.
  const [dayRows, setDayRows] = useState<CalendarDayDto[] | undefined>(undefined);

  const nextYear = new Date().getUTCFullYear() + 1;
  const known = new Map(settings.holidays.map((year) => [year.year, year]));
  const years = [...known.keys(), ...(known.has(nextYear) ? [] : [nextYear])].sort();

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function readDay(date: string) {
    setDayRows(undefined);
    if (!date) return;
    // Один день через ту же ручку, что красит сетку: отдельной «прочитать день»
    // у сервера нет, а своя логика «праздник ли это» разошлась бы с сеткой.
    setDayRows(await apiClient.getDayCalendar(date, date));
  }

  function toggleAuto() {
    void run(async () => {
      await apiClient.setHolidaysAuto(!settings.holidaysAuto);
      await onChanged();
    }, "Не удалось переключить");
  }

  /** Итог по каждому году словами: «ещё не опубликован» — не ошибка. */
  function refresh() {
    setNotice(null);
    void run(async () => {
      const result = await apiClient.refreshHolidays();
      setNotice(
        result
          .map((year) =>
            year.status === "ok" ? `${year.year}: загружено ${year.added}`
            : year.status === "bundled" ? `${year.year}: источник не ответил, взята зашитая копия`
            : year.status === "missing" ? `${year.year}: ещё не опубликован`
            : `${year.year}: не загрузился`,
          )
          .join(" · "),
      );
      await onChanged();
    }, "Не удалось обновить");
  }

  function mark(kind: "holiday" | "workday" | null) {
    const date = day;
    void run(async () => {
      await apiClient.setCalendarDay(date, kind);
      await Promise.all([readDay(date), onChanged()]);
    }, "Не удалось отметить день");
  }

  const row = dayRows?.find((r) => r.date === day);
  const off = day ? isDayOff(day, calendarFrom(dayRows ?? [])) : false;
  const dayState = !day
    ? "Выберите день, чтобы отметить его"
    : dayRows === undefined
      ? "Загрузка…"
      : `${dayOffLabel(day, row?.kind, row?.note ?? null) ?? (off ? "Обычный выходной" : "Обычный рабочий день")}${row?.source === "manual" ? " (вручную)" : ""}`;

  return (
    <div className="settings-card" data-settings="holidays">
      <div className="settings-state">Праздники</div>
      <label className="settings-toggle">
        <input type="checkbox" checked={settings.holidaysAuto} disabled={busy} onChange={toggleAuto} />
        Брать праздники из календаря
      </label>
      <span className="settings-reminder-note">
        Производственный календарь РФ с xmlcalendar.ru. Дни, отмеченные руками, автозагрузка не трогает.
      </span>
      <div className="settings-years">
        {years.map((year) => {
          const loaded = known.get(year);
          return (
            <div key={year} className="settings-who">
              {loaded
                ? `${year}: ${loaded.days} дн., обновлено ${formatAuditMoment(loaded.refreshedAt)}${loaded.source === "bundled" ? " (зашитая копия)" : ""}`
                : `${year}: ещё не опубликован`}
            </div>
          );
        })}
      </div>
      {notice && <div className="settings-result">{notice}</div>}
      {error && <div className="employees-error">{error}</div>}
      <div className="settings-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={refresh}>
          {busy ? "Обновляю…" : "Обновить сейчас"}
        </button>
      </div>

      <div className="settings-day">
        <label className="settings-day-field">
          <span className="field-label">Отметить день</span>
          <input
            type="date"
            value={day}
            disabled={busy}
            onChange={(e) => {
              setDay(e.target.value);
              setError(null);
              void readDay(e.target.value).catch((err: unknown) =>
                setError(err instanceof Error ? err.message : "Не удалось прочитать день"),
              );
            }}
          />
        </label>
        <span className="settings-who">{dayState}</span>
        {day && dayRows !== undefined && (
          <div className="settings-actions">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => mark(off ? "workday" : "holiday")}>
              {off ? "Сделать рабочим" : "Сделать выходным"}
            </button>
            {row?.source === "manual" && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => mark(null)}>
                Как в календаре
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
