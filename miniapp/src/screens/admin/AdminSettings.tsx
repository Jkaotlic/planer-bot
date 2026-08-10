import { useEffect, useState } from "react";
import { formatAuditMoment } from "@planer/shared";
import { Button, Cell, List, Section, Spinner, Switch } from "@telegram-apps/telegram-ui";
import { apiClient, type AdminSettings as AdminSettingsData, type SwapLockResult } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import { withNotifyNotice } from "../../lib/shift";

/**
 * «Настройки» (admin, mobile): пока один тумблер — общий замок обменов сменами.
 * Он пишет сразу всей команде и отменяет чужие незакрытые заявки, поэтому
 * первое нажатие только «взводит» подтверждение (`confirming`), а отправляет —
 * второе. Тот же узор, что у кнопки рассылки на «Сборах»
 * (`AdminCollections.tsx`).
 *
 * Ошибка сохранения рисуется рядом с тумблером, а не вместо него — тот же
 * приём, что и в веб-консоли (`SettingsScreen.tsx`): этот экран не должен
 * превращаться в тупик без перезагрузки, как уже дважды случалось в проекте.
 */
export function AdminSettings() {
  const [settings, setSettings] = useState<AdminSettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SwapLockResult | null>(null);

  async function reload() {
    try {
      setSettings(await apiClient.getSettings());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить настройки");
    }
  }

  useEffect(() => {
    void reload();
    // Загружается один раз; тумблер ниже перечитывает состояние сам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error && !settings) {
    return (
      <ScreenScroll>
        <List>
          <Section header="Настройки">
            <CardShell>
              <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
            </CardShell>
          </Section>
        </List>
      </ScreenScroll>
    );
  }

  if (!settings) {
    return (
      <ScreenScroll>
        <List>
          <Section header="Настройки">
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
              <Spinner size="m" />
            </div>
          </Section>
        </List>
      </ScreenScroll>
    );
  }

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

  const resultLine = result
    ? withNotifyNotice(
        result.locked ? `Обмены закрыты. Отменено заявок: ${result.cancelled}.` : "Обмены открыты.",
        result,
      )
    : null;

  return (
    <ScreenScroll>
      <List>
        <Section header="Настройки">
          {/* Тумблер только показывает состояние — он выключен, потому что менять
              его можно исключительно через кнопки ниже (с подтверждением). */}
          <Cell
            after={<Switch checked={locked} disabled readOnly aria-label="Обмены смен" />}
            description={whoLabel}
          >
            Обмены смен — {locked ? "Закрыты" : "Открыты"}
          </Cell>

          <CardStack>
            <CardShell>
              <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
                Закрытые обмены отменяют все неотвеченные заявки и пишут об этом всей команде.
              </div>
            </CardShell>

            {error && (
              <CardShell>
                <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
              </CardShell>
            )}

            {resultLine && (
              <CardShell>
                <div style={{ fontSize: 13.5 }}>{resultLine}</div>
              </CardShell>
            )}

            <CardShell>
              {confirming ? (
                <>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                    {locked
                      ? "Открыть обмены обратно?"
                      : "Закрыть обмены? Незакрытые заявки отменятся, и об этом напишут всей команде."}
                  </div>
                  <Button size="s" mode="filled" stretched disabled={saving} onClick={() => void handleConfirm()}>
                    {saving ? "Отправляю…" : confirmLabel}
                  </Button>
                  <Button size="s" mode="gray" stretched disabled={saving} onClick={() => setConfirming(false)}>
                    Отмена
                  </Button>
                </>
              ) : (
                <Button
                  size="s"
                  mode="bezeled"
                  stretched
                  disabled={saving}
                  onClick={() => {
                    setResult(null);
                    setError(null);
                    setConfirming(true);
                  }}
                >
                  {actionLabel}
                </Button>
              )}
            </CardShell>
          </CardStack>
        </Section>
      </List>
    </ScreenScroll>
  );
}
