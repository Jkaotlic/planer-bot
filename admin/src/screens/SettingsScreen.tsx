import { useEffect, useState } from "react";
import { formatAuditMoment, validateReminderHour } from "@planer/shared";
import { apiClient, AuthRequiredError, type AdminSettings, type SwapLockResult } from "../api/client";
import { withNotifyNotice } from "../lib/notify-text";

/**
 * «Настройки»: тумблер замка обменов и час, в который уходят напоминания.
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
    </div>
  );
}
