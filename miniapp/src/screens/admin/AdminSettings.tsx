import { useEffect, useState } from "react";
import { formatAuditMoment, validateReminderHour } from "@planer/shared";
import { Button, Cell, List, Section, Spinner, Switch } from "@telegram-apps/telegram-ui";
import { apiClient, type AdminSettings as AdminSettingsData, type NoticePref, type SwapLockResult } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";
import { withNotifyNotice } from "../../lib/shift";

/**
 * «Настройки» (admin, mobile): общий замок обменов сменами и то, какие письма
 * этот админ вообще получает.
 *
 * Замок пишет сразу всей команде и отменяет чужие незакрытые заявки, поэтому
 * первое нажатие только «взводит» подтверждение (`confirming`), а отправляет —
 * второе. Тот же узор, что у кнопки рассылки на «Сборах»
 * (`AdminCollections.tsx`).
 *
 * Ошибка сохранения рисуется рядом с тумблером, а не вместо него — тот же
 * приём, что и в веб-консоли (`SettingsScreen.tsx`): этот экран не должен
 * превращаться в тупик без перезагрузки, как уже дважды случалось в проекте.
 * Список видов уведомлений ниже переживает свою ошибку тем же способом: тумблер
 * откатывается назад, а не гасит весь экран.
 */
export function AdminSettings() {
  const [settings, setSettings] = useState<AdminSettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SwapLockResult | null>(null);
  const [hour, setHour] = useState<string | null>(null);
  const [hourError, setHourError] = useState<string | null>(null);
  const [hourSaved, setHourSaved] = useState(false);
  const [savingHour, setSavingHour] = useState(false);

  const [noticePrefs, setNoticePrefs] = useState<NoticePref[] | null>(null);
  const [noticeLoadError, setNoticeLoadError] = useState<string | null>(null);
  // По виду письма, а не одна общая: переключение «Обмены сменами» не должно
  // гасить ошибку, оставшуюся от неудачной попытки на «Дни рождения».
  const [noticeErrors, setNoticeErrors] = useState<Record<string, string>>({});

  const [savingHolidays, setSavingHolidays] = useState(false);
  const [holidaysNotice, setHolidaysNotice] = useState<string | null>(null);
  const [holidaysError, setHolidaysError] = useState<string | null>(null);

  async function handleHolidaysAuto(enabled: boolean) {
    setSavingHolidays(true);
    setHolidaysError(null);
    try {
      await apiClient.setHolidaysAuto(enabled);
      await reload();
    } catch (err) {
      setHolidaysError(err instanceof Error ? err.message : "Не удалось переключить");
    } finally {
      setSavingHolidays(false);
    }
  }

  /** Итог по каждому году словами: «ещё не опубликован» — не ошибка. */
  async function handleRefreshHolidays() {
    setSavingHolidays(true);
    setHolidaysError(null);
    setHolidaysNotice(null);
    try {
      const years = await apiClient.refreshHolidays();
      setHolidaysNotice(
        years
          .map((year) =>
            year.status === "ok" ? `${year.year}: загружено ${year.added}`
            : year.status === "bundled" ? `${year.year}: источник не ответил, взята зашитая копия`
            : year.status === "missing" ? `${year.year}: ещё не опубликован`
            : `${year.year}: не загрузился`,
          )
          .join(" · "),
      );
      await reload();
    } catch (err) {
      setHolidaysError(err instanceof Error ? err.message : "Не удалось обновить");
    } finally {
      setSavingHolidays(false);
    }
  }

  async function reload() {
    try {
      const next = await apiClient.getSettings();
      setSettings(next);
      // Поле берёт серверное значение только пока его не начали править: иначе
      // перечитывание после соседнего тумблера стёрло бы набранное.
      setHour((current) => current ?? next.reminderHour);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить настройки");
    }
  }

  async function reloadNoticePrefs() {
    try {
      const { kinds } = await apiClient.getNoticePrefs();
      setNoticePrefs(kinds);
    } catch (err) {
      setNoticeLoadError(err instanceof Error ? err.message : "Не удалось загрузить список уведомлений");
    }
  }

  async function toggleNotice(kind: string, next: boolean) {
    // Оптимистично, как «Напоминания о сменах» (`RemindersSwitch`): тумблер,
    // отстающий от пальца, читается как сломанный. Catch ниже возвращает его
    // назад, если сервер не согласился.
    setNoticePrefs((prev) => prev?.map((p) => (p.kind === kind ? { ...p, enabled: next } : p)) ?? prev);
    setNoticeErrors((prev) => {
      const rest = { ...prev };
      delete rest[kind];
      return rest;
    });
    try {
      const saved = await apiClient.setNoticePref(kind, next);
      setNoticePrefs((prev) => prev?.map((p) => (p.kind === kind ? { ...p, enabled: saved.enabled } : p)) ?? prev);
    } catch (err) {
      setNoticePrefs((prev) => prev?.map((p) => (p.kind === kind ? { ...p, enabled: !next } : p)) ?? prev);
      setNoticeErrors((prev) => ({ ...prev, [kind]: err instanceof Error ? err.message : "Не удалось сохранить" }));
    }
  }

  useEffect(() => {
    void reload();
    void reloadNoticePrefs();
    // Загружается один раз; тумблеры ниже перечитывают состояние сами.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm() {
    // Кнопка, которая это вызывает, отрисовывается только когда `settings`
    // загружен (см. `renderSwapsSection` ниже) — проверка здесь только защищает
    // типы от гипотетической гонки, а не меняет обычный путь.
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const outcome = await apiClient.setSwapsLock(!settings.swapsLocked);
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
    const value = hour ?? settings?.reminderHour ?? "";
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

  /**
   * Час рассылки напоминаний — своя секция, своя ошибка.
   *
   * Проверка та же, что на сервере (`validateReminderHour`): про запрет «позже
   * 23:30» админ должен узнать до отправки, а не по отказу.
   */
  function renderReminderSection() {
    if (!settings) return null;
    return (
      <CardStack>
        <CardShell>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
            Уходят накануне в
            <input
              type="time"
              value={hour ?? settings.reminderHour}
              disabled={savingHour}
              onChange={(e) => {
                setHour(e.target.value);
                setHourError(null);
                setHourSaved(false);
              }}
              style={{
                padding: "5px 8px", borderRadius: 8, border: "1px solid var(--tgui--outline)",
                background: "var(--tgui--secondary_bg_color)", color: "var(--tgui--text_color)", font: "inherit",
              }}
            />
          </label>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5, lineHeight: 1.45, marginTop: 6 }}>
            Проверяется раз в пять минут, поэтому уходит первым тиком после этого времени.
            {settings.reminderHourUpdatedBy === null ? " Час ни разу не меняли." : ` Поставил ${settings.reminderHourUpdatedBy}.`}
          </div>
          {hourError && (
            <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5, marginTop: 6 }}>{hourError}</div>
          )}
          {hourSaved && <div style={{ fontSize: 13.5, marginTop: 6 }}>Час сохранён.</div>}
          <Button size="s" mode="bezeled" stretched disabled={savingHour} style={{ marginTop: 8 }} onClick={() => void handleHour()}>
            {savingHour ? "Сохраняю…" : "Сохранить час"}
          </Button>
        </CardShell>
      </CardStack>
    );
  }

  /**
   * Секция «Праздники»: рычаг автозагрузки, что уже загружено и кнопка.
   *
   * Год, которого в ответе нет, подписан «ещё не опубликован»: 404 источника —
   * это «Правительство пока не утвердило», и промолчать значило бы показать
   * пустоту, которая читается как сбой.
   */
  function renderHolidaysSection() {
    if (!settings) return null;
    const nextYear = new Date().getUTCFullYear() + 1;
    const known = new Map(settings.holidays.map((year) => [year.year, year]));
    const years = [...settings.holidays.map((year) => year.year), ...(known.has(nextYear) ? [] : [nextYear])].sort();

    return (
      <>
        <Cell
          after={
            <Switch
              checked={settings.holidaysAuto}
              disabled={savingHolidays}
              aria-label="Брать праздники из календаря"
              onChange={() => void handleHolidaysAuto(!settings.holidaysAuto)}
            />
          }
          description="Производственный календарь РФ с xmlcalendar.ru. Дни, отмеченные руками, автозагрузка не трогает."
        >
          Брать праздники из календаря
        </Cell>
        <CardStack>
          <CardShell>
            {years.map((year) => {
              const row = known.get(year);
              return (
                <div key={year} style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
                  {row
                    ? `${year}: ${row.days} дн., обновлено ${formatAuditMoment(row.refreshedAt)}${row.source === "bundled" ? " (зашитая копия)" : ""}`
                    : `${year}: ещё не опубликован`}
                </div>
              );
            })}
            {holidaysNotice && <div style={{ fontSize: 13.5, marginTop: 6 }}>{holidaysNotice}</div>}
            {holidaysError && (
              <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5, marginTop: 6 }}>{holidaysError}</div>
            )}
            <Button size="s" mode="bezeled" stretched disabled={savingHolidays} style={{ marginTop: 8 }} onClick={() => void handleRefreshHolidays()}>
              {savingHolidays ? "Обновляю…" : "Обновить сейчас"}
            </Button>
          </CardShell>
        </CardStack>
      </>
    );
  }

  /**
   * Содержимое секции «Настройки» (замок обменов) — своя загрузка, своя ошибка,
   * свой спиннер. Раньше сбой или ожидание `GET /api/admin/settings` подменяли
   * весь экран через ранний `return` из компонента, из-за чего секция «Что мне
   * писать» ниже становилась недостижимой, даже если её собственный запрос
   * успел отработать. Теперь каждая секция отвечает сама за себя.
   */
  function renderSwapsSection() {
    if (error && !settings) {
      return (
        <CardShell>
          <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
        </CardShell>
      );
    }

    if (!settings) {
      return (
        <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
          <Spinner size="m" />
        </div>
      );
    }

    const locked = settings.swapsLocked;
    const actionLabel = locked ? "Открыть обмены" : "Закрыть обмены";
    const confirmLabel = locked ? "Да, открыть" : "Да, закрыть";
    const whoLabel =
      settings.swapsLockUpdatedAt === null
        ? "Ни разу не меняли"
        : `${locked ? "Закрыл" : "Открыл"} ${settings.swapsLockUpdatedBy ?? "неизвестно кто"} · ${formatAuditMoment(settings.swapsLockUpdatedAt)}`;

    const resultLine = result
      ? withNotifyNotice(
          result.locked ? `Обмены закрыты. Отменено заявок: ${result.cancelled}.` : "Обмены открыты.",
          result,
        )
      : null;

    return (
      <>
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
      </>
    );
  }

  return (
    <ScreenScroll>
      <List>
        <Section header="Настройки">{renderSwapsSection()}</Section>

        <Section header="Напоминания о смене">{renderReminderSection()}</Section>

        <Section header="Праздники">{renderHolidaysSection()}</Section>

        <Section header="Что мне писать">
          {noticePrefs === null ? (
            noticeLoadError ? (
              <CardStack>
                <CardShell>
                  <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{noticeLoadError}</div>
                </CardShell>
              </CardStack>
            ) : (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <Spinner size="m" />
              </div>
            )
          ) : (
            <>
              {noticePrefs.map((pref) => (
                <div key={pref.kind}>
                  <Cell
                    Component="label"
                    after={<Switch checked={pref.enabled} onChange={(e) => void toggleNotice(pref.kind, e.target.checked)} />}
                    multiline
                    description={pref.hint}
                  >
                    {pref.title}
                  </Cell>
                  {noticeErrors[pref.kind] && (
                    <div style={{ padding: "0 20px 10px", color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>
                      {noticeErrors[pref.kind]}
                    </div>
                  )}
                </div>
              ))}

              <CardStack>
                <CardShell>
                  <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
                    Письмо «смену никто не взял» приходит всегда — его выключить нельзя.
                  </div>
                </CardShell>
              </CardStack>
            </>
          )}
        </Section>
      </List>
    </ScreenScroll>
  );
}
