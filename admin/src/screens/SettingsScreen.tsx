import { useEffect, useState } from "react";
import { formatAuditMoment } from "@planer/shared";
import { apiClient, AuthRequiredError, type AdminSettings, type SwapLockResult } from "../api/client";
import { withNotifyNotice } from "../lib/notify-text";

/**
 * «Настройки»: пока один тумблер — общий замок обменов сменами. Он пишет сразу
 * всей команде и отменяет чужие незакрытые заявки, поэтому первое нажатие
 * только «взводит» подтверждение (`confirming`), а отправляет — второе. Тот же
 * узор, что у кнопки рассылки на «Днях рождения» (`BirthdaysScreen.tsx`).
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

  async function reload() {
    try {
      setSettings(await apiClient.getSettings());
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
    settings.swapsLockUpdatedBy === null
      ? "Ни разу не меняли"
      : `${locked ? "Закрыл" : "Открыл"} ${settings.swapsLockUpdatedBy}${
          settings.swapsLockUpdatedAt ? ` · ${formatAuditMoment(settings.swapsLockUpdatedAt)}` : ""
        }`;

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
              {confirmLabel}
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
    </div>
  );
}
