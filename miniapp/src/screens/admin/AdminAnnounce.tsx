import { useEffect, useState } from "react";
import { Button, List, Placeholder, Section, SegmentedControl, Spinner, Textarea } from "@telegram-apps/telegram-ui";
import { ANNOUNCEMENT_TEXT_MAX, apiClient, type AnnouncementResult, type Employee } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { ScreenScroll } from "../../components/ScreenScroll";

/**
 * «Анонсы» (admin): вольный текст всей команде или выбранным.
 *
 * Единственная рассылка в системе, которая проходит сквозь ВСЕ настройки
 * уведомлений — отписаться от неё нельзя (см. `announcement-service.ts`).
 * Именно поэтому подтверждение здесь обязательно, а не для красоты:
 * отправленное в Telegram сообщение не отзывается. Кнопка отправки взводится
 * первым тапом и шлёт вторым — тот же узор, что у рассылки на «Сборах», и
 * до того — поимённый список тех, кому уйдёт, а не только число.
 *
 * Превью-эндпоинта на сервере нет намеренно (текст анонса — ровно то, что
 * напечатал админ, ходить за ним на сервер незачем), поэтому список
 * получателей и подсчёт недостижимых собирает сам экран — тем же списком
 * работников, что грузит «Работники» (`getAdminEmployees`), а не вторым
 * запросом.
 */
export function AdminAnnounce() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [viewerId, setViewerId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [audienceMode, setAudienceMode] = useState<"all" | "picked">("all");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AnnouncementResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [me, list] = await Promise.all([apiClient.getMe(), apiClient.getAdminEmployees()]);
        if (cancelled) return;
        setViewerId(me.id);
        setEmployees(list);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Не удалось загрузить работников");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <ScreenScroll>
        <Placeholder header="Не удалось загрузить" description={loadError} />
      </ScreenScroll>
    );
  }
  if (!employees) {
    return (
      <ScreenScroll style={{ display: "flex", justifyContent: "center", paddingTop: 48 }}>
        <Spinner size="l" />
      </ScreenScroll>
    );
  }

  // Сам себе анонс не шлёт никто — тем же правилом, что «Кому» у сборов.
  const active = employees.filter((e) => e.isActive && e.id !== viewerId);
  const recipients = audienceMode === "all" ? active : active.filter((e) => selectedIds.has(e.id));
  // Выбранный явно, но без телеграма или уже в архиве, в отчёт попадёт — но
  // не в это число: сервер его тоже не отправит. Показываем заранее, а не
  // только в отчёте после отправки, чтобы «кому уйдёт» не расходилось с тем,
  // что реально дойдёт.
  const reachable = recipients.filter((e) => e.telegramUserId != null);
  const overLimit = text.length > ANNOUNCEMENT_TEXT_MAX;
  const canSend = text.trim().length > 0 && !overLimit && reachable.length > 0;

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const audience = audienceMode === "all" ? "all" : [...selectedIds];
      const result = await apiClient.sendAnnouncement(text.trim(), audience);
      setReport(result);
      setConfirming(false);
      setText("");
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить");
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  return (
    <ScreenScroll>
      <List>
        <Section header="Анонс">
          <CardStack>
            <CardShell>
              <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
                Уходит в обход всех личных настроек уведомлений — отписаться от анонсов нельзя. Отправленное
                сообщение не отзывается, поэтому перед отправкой экран показывает точный список получателей.
              </div>
            </CardShell>

            <CardShell>
              <Textarea
                header="Текст"
                rows={5}
                placeholder="Что сказать команде"
                value={text}
                disabled={sending}
                onChange={(e) => {
                  setText(e.target.value);
                  setConfirming(false);
                }}
              />
              <div
                style={{
                  textAlign: "right",
                  fontSize: 12.5,
                  color: overLimit ? "var(--tgui--destructive_text_color)" : "var(--tgui--hint_color)",
                }}
              >
                {text.length} / {ANNOUNCEMENT_TEXT_MAX}
              </div>
            </CardShell>

            <CardShell>
              <SegmentedControl>
                <SegmentedControl.Item
                  selected={audienceMode === "all"}
                  onClick={() => {
                    setAudienceMode("all");
                    setConfirming(false);
                  }}
                >
                  Всем
                </SegmentedControl.Item>
                <SegmentedControl.Item
                  selected={audienceMode === "picked"}
                  onClick={() => {
                    setAudienceMode("picked");
                    setConfirming(false);
                  }}
                >
                  Выбрать
                </SegmentedControl.Item>
              </SegmentedControl>

              {audienceMode === "picked" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10 }}>
                  {active.length === 0 ? (
                    <div style={{ color: "var(--tgui--hint_color)", fontSize: 13.5 }}>Выбирать некого.</div>
                  ) : (
                    active.map((e) => (
                      <label
                        key={e.id}
                        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, padding: "4px 0", cursor: "pointer" }}
                      >
                        <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggle(e.id)} />
                        <span>{e.displayName}</span>
                        {e.telegramUserId == null && (
                          <span style={{ color: "var(--tgui--hint_color)", fontSize: 12 }}>— не привязан</span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              )}

              <div style={{ marginTop: 10, color: "var(--tgui--hint_color)", fontSize: 12.5, fontWeight: 600 }}>
                Уйдёт {reachable.length === 0 ? "некому" : `${reachable.length}:`}
              </div>
              {reachable.length > 0 && (
                <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
                  {reachable.map((e) => e.displayName).join(", ")}
                </div>
              )}
            </CardShell>

            {error && (
              <CardShell>
                <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
              </CardShell>
            )}

            <CardShell>
              {confirming ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                    Отправить {reachable.length} {reachable.length === 1 ? "коллеге" : "коллегам"}? Отменить будет
                    нельзя — сообщение уйдёт сразу.
                  </div>
                  <Button size="s" mode="filled" stretched loading={sending} disabled={sending} onClick={() => void handleSend()}>
                    {sending ? "Отправляю…" : "Да, отправить"}
                  </Button>
                  <Button size="s" mode="gray" stretched disabled={sending} onClick={() => setConfirming(false)}>
                    Отмена
                  </Button>
                </div>
              ) : (
                <Button size="s" mode="filled" stretched disabled={!canSend} onClick={() => setConfirming(true)}>
                  Отправить
                </Button>
              )}
            </CardShell>

            {report && (
              <CardShell>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  Дошло {report.delivered} из {report.intended}.
                </div>
                {report.unreachable.length > 0 && (
                  <div style={{ marginTop: 6, color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
                    Не получили (нет телеграма или в архиве): {report.unreachable.join(", ")}
                  </div>
                )}
              </CardShell>
            )}
          </CardStack>
        </Section>
      </List>
    </ScreenScroll>
  );
}
