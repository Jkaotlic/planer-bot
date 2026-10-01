import { useEffect, useState } from "react";
import { announcementUnreachableLine, filterPeople, presetRecipientIds, type AnnouncementPreset } from "@planer/shared";
import { Placeholder, SegmentedControl, Spinner, Textarea } from "@telegram-apps/telegram-ui";
import { ANNOUNCEMENT_TEXT_MAX, apiClient, type AnnouncementRecipient, type AnnouncementResult, type RecipientGroupView } from "../../api/client";
import { PersonSearch } from "../../components/PersonSearch";
import { TapHeight } from "../../components/TapHeight";
import { ActionButton, Card, CheckRow, Group, Hint } from "../../ui";

/**
 * «Анонсы»: вольный текст всей команде или выбранным. Открыт и админу (вкладка
 * «Админ»), и наблюдателю (своя вкладка «Анонс», см. `TabBar`) — у обоих
 * `canAnnounce`, и экран один на двоих: разница в правах, а не в вёрстке.
 *
 * Единственная рассылка в системе, которая проходит сквозь ВСЕ настройки
 * уведомлений — отписаться от неё нельзя (см. `announcement-service.ts`).
 * Именно поэтому подтверждение здесь обязательно, а не для красоты:
 * отправленное в Telegram сообщение не отзывается. Кнопка отправки взводится
 * первым тапом и шлёт вторым — тот же узор, что у рассылки на «Сборах», и
 * до того — поимённый список тех, кому уйдёт, а не только число.
 *
 * Превью-эндпоинта на сервере нет намеренно (текст анонса — ровно то, что
 * напечатал отправитель, ходить за ним на сервер незачем), но КОМУ уйдёт и
 * кто недостижим считает сервер (`GET /api/announcements/recipients`), а не
 * этот экран сам по списку работников: у наблюдателя нет доступа к
 * `getAdminEmployees` (админской ручке), а «сам себе не шлёт» и «есть ли
 * телеграм» — то же самое правило, что применяет сама отправка, и держать
 * его здесь второй копией значило бы дать ему разъехаться с сервером.
 */
export function AdminAnnounce() {
  const [recipients, setRecipients] = useState<AnnouncementRecipient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [audienceMode, setAudienceMode] = useState<"all" | "picked">("all");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  /** Какая подборка горит. Сбрасывается ручной галочкой: список уже не «все админы». */
  const [preset, setPreset] = useState<AnnouncementPreset | null>(null);
  const [groups, setGroups] = useState<RecipientGroupView[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AnnouncementResult | null>(null);

  // Группы — удобство: сбой загрузки не должен ронять экран анонса.
  useEffect(() => {
    let cancelled = false;
    apiClient.getRecipientGroups()
      .then((list) => { if (!cancelled) setGroups(list); })
      .catch(() => { /* нет ряда групп — и всё */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await apiClient.getAnnouncementRecipients();
        if (!cancelled) setRecipients(list);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Не удалось загрузить получателей");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return <Placeholder header="Не удалось загрузить" description={loadError} />;
  }
  if (!recipients) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 48 }}>
        <Spinner size="l" />
      </div>
    );
  }

  // Сервер уже исключил самого отправителя и архивных — здесь только выбор.
  // Фильтруется ТОЛЬКО отрисовка. `selectedIds` живёт своей жизнью, а «Уйдёт»
  // ниже считается из полного списка: анонс не отзывается и идёт сквозь все
  // настройки тишины, и поиск, роняющий выбор скрытых, однажды отправит
  // сообщение не тем.
  const picked = audienceMode === "all" ? recipients : recipients.filter((e) => selectedIds.has(e.id));
  // Список рисуется из отфильтрованного — но только рисуется, см. комментарий выше.
  const filteredRecipients = filterPeople(recipients, query);
  // Выбранный явно, но без телеграма, в отчёт попадёт — но не в это число:
  // сервер его тоже не отправит. Показываем заранее, а не только в отчёте
  // после отправки, чтобы «кому уйдёт» не расходилось с тем, что реально дойдёт.
  const reachable = picked.filter((e) => e.reachable);
  const overLimit = text.length > ANNOUNCEMENT_TEXT_MAX;
  const canSend = text.trim().length > 0 && !overLimit && reachable.length > 0;

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreset(null);
    setGroupId(null);
    setConfirming(false);
  }

  /** Подборка — обычный выбор галочками, отмеченный за отправителя: он видит,
   *  кому уйдёт, и может поправить. */
  function pickPreset(next: AnnouncementPreset) {
    setAudienceMode("picked");
    setSelectedIds(new Set(presetRecipientIds(recipients ?? [], next)));
    setPreset(next);
    setGroupId(null);
    setConfirming(false);
  }

  /** Группа — тоже обычный выбор галочками; чужие id (не из этого списка) отбрасываем. */
  function pickGroup(g: RecipientGroupView) {
    const known = new Set((recipients ?? []).map((e) => e.id));
    setAudienceMode("picked");
    setSelectedIds(new Set(g.memberIds.filter((id) => known.has(id))));
    setPreset(null);
    setGroupId(g.id);
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

  const unreachableLine = report ? announcementUnreachableLine(report.unreachable, report.archivedCount) : null;

  // Заголовок «Анонс(ы)» даёт `Screen` снаружи — и в `AdminScreen`, и в `App` для
  // наблюдателя. Своего заголовка здесь нет: два `h1` на экране путали скринридер.
  return (
    <Group>
      <Hint>
        Уходит в обход всех личных настроек уведомлений — отписаться от анонсов нельзя. Отправленное
        сообщение не отзывается, поэтому перед отправкой экран показывает точный список получателей.
      </Hint>

      <Card>
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
            fontSize: "var(--app-text-meta)",
            color: overLimit ? "var(--tgui--destructive_text_color)" : "var(--tgui--hint_color)",
          }}
        >
          {text.length} / {ANNOUNCEMENT_TEXT_MAX}
        </div>
      </Card>

      <Card>
        <TapHeight>
          <SegmentedControl>
            <SegmentedControl.Item
              selected={audienceMode === "all"}
              onClick={() => {
                setAudienceMode("all");
                setPreset(null);
                setGroupId(null);
                setConfirming(false);
              }}
            >
              Всем
            </SegmentedControl.Item>
            <SegmentedControl.Item
              selected={audienceMode === "picked"}
              onClick={() => {
                setAudienceMode("picked");
                setPreset(null);
                setGroupId(null);
                setConfirming(false);
              }}
            >
              Выбрать
            </SegmentedControl.Item>
          </SegmentedControl>
        </TapHeight>
        {/* Подборки — отдельным рядом, а не сегментами: четыре сегмента на
            320–375px сжимались до «В… А… Р… В…» (замер 2026-09-29). Выбранная —
            плотным тоном (`aria-pressed`), не `primary`: главная кнопка — «Отправить». */}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <ActionButton compact kind={preset === "admins" ? "secondary" : "quiet"} aria-pressed={preset === "admins"} disabled={sending} onClick={() => pickPreset("admins")}>
            Админам
          </ActionButton>
          <ActionButton compact kind={preset === "workers" ? "secondary" : "quiet"} aria-pressed={preset === "workers"} disabled={sending} onClick={() => pickPreset("workers")}>
            Работникам
          </ActionButton>
        </div>
        {groups.length > 0 && (
          <div data-testid="group-row" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {groups.map((g) => (
              <ActionButton key={g.id} compact kind={groupId === g.id ? "secondary" : "quiet"} aria-pressed={groupId === g.id} disabled={sending} onClick={() => pickGroup(g)}>
                {g.name}
              </ActionButton>
            ))}
          </div>
        )}

        {audienceMode === "picked" && (
          <div style={{ marginTop: 10 }}>
            <PersonSearch value={query} onChange={setQuery} count={recipients.length} disabled={sending} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {recipients.length === 0 ? (
                <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>Выбирать некого.</div>
              ) : filteredRecipients.length === 0 ? (
                <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>Никого с таким именем нет.</div>
              ) : (
                filteredRecipients.map((e) => (
                  // Обёртка несёт класс строки: по нему её находят тесты, а `CheckRow`
                  // своего класса наружу не отдаёт.
                  <div key={e.id} className="announce-picker-row">
                    <CheckRow
                      checked={selectedIds.has(e.id)}
                      disabled={sending}
                      onChange={() => toggle(e.id)}
                      label={e.displayName}
                      hint={!e.reachable ? "— не привязан" : undefined}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: 10, color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", fontWeight: 600 }}>
          Уйдёт {reachable.length === 0 ? "некому" : `${reachable.length}:`}
        </div>
        {reachable.length > 0 && (
          <div
            className="announce-recipients-preview"
            style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", lineHeight: 1.45 }}
          >
            {reachable.map((e) => e.displayName).join(", ")}
          </div>
        )}
      </Card>

      {error && (
        <Card>
          <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>
        </Card>
      )}

      {/* Единственная `primary` экрана в каждый момент: «Отправить» — или, после
          первого тапа, «Да, отправить»; обе завершают действие. */}
      <Card>
        {confirming ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: "var(--app-text-meta)", lineHeight: 1.45 }}>
              Отправить {reachable.length} {reachable.length === 1 ? "коллеге" : "коллегам"}? Отменить будет
              нельзя — сообщение уйдёт сразу.
            </div>
            <ActionButton kind="primary" stretched loading={sending} disabled={sending} onClick={() => void handleSend()}>
              {sending ? "Отправляю…" : "Да, отправить"}
            </ActionButton>
            <ActionButton stretched disabled={sending} onClick={() => setConfirming(false)}>
              Отмена
            </ActionButton>
          </div>
        ) : (
          <ActionButton kind="primary" stretched disabled={!canSend} onClick={() => setConfirming(true)}>
            Отправить
          </ActionButton>
        )}
      </Card>

      {report && (
        <Card>
          <div style={{ fontSize: "var(--app-text-meta)", fontWeight: 600 }}>
            Дошло {report.delivered} из {report.intended}.
          </div>
          {unreachableLine && (
            <div style={{ marginTop: 6, color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)", lineHeight: 1.45 }}>
              {unreachableLine}
            </div>
          )}
        </Card>
      )}
    </Group>
  );
}

// Именованный экспорт — для `AdminScreen` (статический импорт, уже часть его
// куска); экспорт по умолчанию — для наблюдателя, у которого «Анонс» это своя
// вкладка, а не раздел админки, и грузится собственным `lazy()`-куском в App.
export default AdminAnnounce;
