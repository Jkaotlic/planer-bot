import { ConfirmButton } from "../../components/ConfirmButton";
import { useEffect, useRef, useState } from "react";
import { Input, Placeholder, Spinner, Textarea } from "@telegram-apps/telegram-ui";
import {
  CHECKLIST_RULE_TEXT,
  checklistDayTotals,
  checklistDeliveryLabel,
  checklistDispatchBadge,
  checklistDispatchReason,
  checklistDispatchState,
  checklistHasContent,
} from "@planer/shared";
import { apiClient, type Checklist, type ChecklistDay, type ChecklistItem, type Template } from "../../api/client";
import { ActionButton, Card, Group, Hint, StatusPill } from "../../ui";

/**
 * «Чек-листы» в мини-аппе — зеркало консольного экрана.
 *
 * Списков несколько: у дежурного с семи и у дежурного с восьми проверки разные,
 * и «скоп смен» задаётся тем, какие виды смен на список ссылаются. Ту же
 * привязку можно поставить и со стороны «Видов смен» — там на неё смотрят как на
 * свойство пресета, здесь как на ответ «кто это проходит».
 *
 * Файл прикладывается здесь же и уходит на диск сервера: браузер не умеет
 * положить документ в Telegram так, чтобы бот потом мог его переслать, поэтому
 * пересылку берёт на себя бот при первой рассылке. Второй путь — прислать файл
 * боту командой `/instruction`; он короче, когда файл уже в телефоне.
 */
export function AdminChecklists() {
  const [checklists, setChecklists] = useState<Checklist[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [day, setDay] = useState<ChecklistDay | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [lists, presets] = await Promise.all([apiClient.getChecklists(), apiClient.getTemplates()]);
      setChecklists(lists);
      setTemplates(presets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить чек-листы");
    }
    // Сводка дня — отдельно и молча: она отвечает на «кому уйдёт сегодня», но её
    // отказ не должен выглядеть поломкой настройки, ради которой сюда пришли.
    // Без даты: «сегодня» считает сервер по поясу команды, а не браузер.
    try {
      setDay(await apiClient.getChecklistDay());
    } catch {
      setDay(null);
    }
  }

  useEffect(() => {
    void reload();
    // Грузится один раз; каждая правка ниже перечитывает явно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** `true` — действие прошло. По нему кнопки чистят поле ввода: отказ,
   *  стиравший набранное, заставлял админа набирать название заново. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Заголовок «Чек-листы» даёт `Screen` в `AdminScreen`: своего здесь нет.
  if (!checklists) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
        <Spinner size="m" />
      </div>
    );
  }

  return (
    <Group>
      {error && (
        <Card>
          <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>
        </Card>
      )}

      <DaySummary day={day} />

      {checklists.length === 0 && (
        <Placeholder description="Чек-листов пока нет — заведи первый, и он начнёт приходить дежурным тех видов смен, которые ты ему укажешь." />
      )}

      {checklists.map((list) => (
        <ChecklistCard
          key={list.id}
          list={list}
          templates={templates}
          day={day}
          open={openId === list.id}
          busy={busy}
          onToggle={() => setOpenId(openId === list.id ? null : list.id)}
          run={run}
        />
      ))}

      <Card>
        <Input
          header="Новый чек-лист"
          placeholder="Например, дежурство с 07:00"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
        />
        {/* Единственная `primary` этой карточки; в раскрытом списке своя, и
            раскрыт одновременно только один. */}
        <ActionButton
          kind="primary"
          stretched
          disabled={busy || !draft.trim()}
          onClick={() => void run(() => apiClient.createChecklist(draft.trim())).then((ok) => ok && setDraft(""))}
        >
          Завести
        </ActionButton>
      </Card>

      {/* Пояснение внизу и серое: сводка дня должна быть первым блоком экрана. */}
      <Hint>
        Проверки, которые дежурный проходит в свою смену. Списков может быть несколько — у выходящих в 07:00 и в 08:00 они разные.
      </Hint>
    </Group>
  );
}

/**
 * Что случилось сегодня — первым блоком экрана.
 *
 * До 2026-08-28 этот расклад лежал ВНУТРИ раскрытой карточки, и человек,
 * открывший экран, не видел его вовсе: вопрос «уходило сегодня хоть что-нибудь»
 * оставался без ответа, пока не тапнешь по нужному списку.
 */
function DaySummary({ day }: { day: ChecklistDay | null }) {
  const people = day?.people ?? [];
  const totals = checklistDayTotals(people);
  // Каждая пилюля — отдельный узел: тест держит «Ушло N / Ждёт N / Не уйдёт N» по одной.
  const chip = (text: string, tone: "ok" | "wait" | "bad") => (
    <StatusPill key={text} tone={tone}>
      {text}
    </StatusPill>
  );

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: people.length > 0 ? 10 : 0 }}>
        <span style={{ fontWeight: 600, fontSize: "var(--app-text-body)" }}>Сегодня</span>
        {people.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {chip(`Ушло ${totals.sent}`, "ok")}
            {chip(`Ждёт ${totals.waiting}`, "wait")}
            {/* Застрявшие выделены отдельно: это единственная строка, по которой
                надо что-то делать руками. */}
            {chip(`Не уйдёт ${totals.blocked}`, totals.blocked > 0 ? "bad" : "wait")}
          </div>
        )}
      </div>

      {people.length === 0 ? (
        <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Сегодня чек-лист никому не положен.</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {people.map((p) => (
            <div key={`${p.employeeId}:${p.checklistId}`} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: "var(--app-text-meta)" }}>
              <span style={{ flex: 1, minWidth: 0 }}>{p.displayName}</span>
              <span
                style={{
                  fontSize: "var(--app-text-meta)",
                  // Синий — только у нажимаемого: «ушло» читается обычным цветом текста.
                  color: p.delivery === "sent"
                    ? "var(--tgui--text_color)"
                    : p.delivery === "scheduled"
                      ? "var(--tgui--hint_color)"
                      : "var(--tgui--destructive_text_color)",
                }}
              >
                {checklistDeliveryLabel(p.delivery, p.start, p.sentAt)} · {p.done} из {p.total}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ChecklistCard({
  list,
  templates,
  day,
  open,
  busy,
  onToggle,
  run,
}: {
  list: Checklist;
  templates: readonly Template[];
  day: ChecklistDay | null;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [itemDraft, setItemDraft] = useState("");
  const [note, setNote] = useState(list.note ?? "");
  const [docUrl, setDocUrl] = useState(list.docUrl ?? "");
  // Скрытое поле файла нажимается кнопкой набора: кнопка внутри `label` не передаёт
  // ему нажатие, поэтому `label` + `Component="span"` больше не годится.
  const fileInput = useRef<HTMLInputElement>(null);
  const linked = templates.filter((t) => list.templateIds.includes(t.id));
  const dirty = note !== (list.note ?? "") || docUrl !== (list.docUrl ?? "");
  // Пояснение и ссылка — единственное здесь, что не сохраняется по тапу, и уйти
  // с экрана, потеряв набранный текст, можно было молча.
  const [saved, setSaved] = useState(false);
  // «Уходит или нет» — тем же правилом, которым живёт рассылка. Ссылка на
  // документ считается содержимым наравне с файлом: бот вешает её кнопкой.
  const dispatch = checklistDispatchState({
    hasContent: checklistHasContent({ items: list.items, note: list.note, hasDoc: list.hasDoc || Boolean(list.docUrl) }),
    linkedTemplateCount: linked.length,
  });
  const todayPeople = day?.people.filter((p) => p.checklistId === list.id) ?? [];

  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2, width: "100%", padding: 0, minHeight: "var(--app-tap)",
          justifyContent: "center", border: 0, background: "none", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer",
        }}
      >
        {/* Название с пилюлей — первой строкой, пояснение — второй, на всю
            ширину: в одной строке с названием оно сжималось в узкую колонку и
            рвалось на три строки. */}
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: "var(--app-text-body)", minWidth: 0, overflowWrap: "anywhere" }}>{list.name}</span>
          {/* Пилюлей, а не серым текстом в общей строке: до 2026-08-28 статус был
              написан правильно, но глаз проходил мимо. Обёртка несёт класс, по
              которому статус находят в тестах. */}
          <span className="checklist-badge" style={{ flex: "none" }}>
            <StatusPill tone={dispatch === "sends" ? "ok" : "bad"}>{checklistDispatchBadge(dispatch)}</StatusPill>
          </span>
          <span aria-hidden="true" style={{ marginLeft: "auto", color: "var(--tgui--hint_color)" }}>{open ? "▴" : "▾"}</span>
        </span>
        <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
          {list.items.length === 0 ? "пунктов нет" : `${list.items.length} п.`}
          {" · "}
          {checklistDispatchReason(dispatch, linked.map((t) => t.name))}
        </span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          {/* «Кому положен» первым: это и есть тот «скоп смен», ради которого
              списков стало несколько. */}
          <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Кому положен</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {templates.map((template) => {
              const on = list.templateIds.includes(template.id);
              return (
                <ActionButton
                  key={template.id}
                  compact
                  aria-pressed={on}
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      apiClient.setChecklistTemplates(
                        list.id,
                        on ? list.templateIds.filter((id) => id !== template.id) : [...list.templateIds, template.id],
                      ),
                    )
                  }
                >
                  {template.name} · {template.start}
                </ActionButton>
              );
            })}
          </div>

          <Hint>
            {CHECKLIST_RULE_TEXT} Виды смен и пункты сохраняются сразу.
          </Hint>

          {/* Сегодняшний расклад рядом с настройкой: «уйдёт ли» проверяют
              ровно в тот момент, когда виды смен только что переключили. */}
          <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Сегодня</span>
          {todayPeople.length === 0 ? (
            <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Сегодня этот чек-лист никому не положен.</span>
          ) : (
            todayPeople.map((p) => (
              <div key={p.employeeId} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: "var(--app-text-meta)" }}>
                <span style={{ flex: 1, minWidth: 0 }}>{p.displayName}</span>
                {/* Судьба сообщения рядом с прогрессом: «0 из 5» у того, кому
                    ничего не ушло, читается как лень человека, а не как
                    выключенные напоминания. */}
                <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>
                  {checklistDeliveryLabel(p.delivery, p.start, p.sentAt)} · {p.done} из {p.total}
                </span>
              </div>
            ))
          )}

          <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Пункты</span>
          {list.items.length === 0 ? (
            <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Пунктов пока нет.</span>
          ) : (
            list.items.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                index={index}
                total={list.items.length}
                busy={busy}
                onSave={(patch) => run(() => apiClient.updateChecklistItem(item.id, patch))}
                onMove={(to) => void run(() => apiClient.reorderChecklistItem(item.id, to))}
                onRemove={() => void run(() => apiClient.removeChecklistItem(item.id))}
              />
            ))
          )}

          <Input
            header={`Новый пункт в «${list.name}»`}
            placeholder="Например, обойти этаж"
            value={itemDraft}
            disabled={busy}
            onChange={(e) => setItemDraft(e.target.value)}
          />
          <ActionButton
            stretched
            disabled={busy || !itemDraft.trim()}
            onClick={() => void run(() => apiClient.addChecklistItem(list.id, itemDraft.trim())).then((ok) => ok && setItemDraft(""))}
          >
            Добавить пункт
          </ActionButton>

          <Textarea
            header="Пояснение — уходит дежурному в чат вместе со списком"
            placeholder="Например: обход начинаем от лифтов, по часовой."
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
          />
          <Input
            header="Ссылка на документ"
            placeholder="https://…"
            value={docUrl}
            disabled={busy}
            onChange={(e) => setDocUrl(e.target.value)}
          />
          {/* `primary` раскрытой карточки: единственное действие, которое не
              сохраняется по тапу, а значит — то, ради которого карточку открыли. */}
          <ActionButton
            kind="primary"
            stretched
            disabled={busy || !dirty}
            onClick={() => {
              setSaved(false);
              void run(() => apiClient.patchChecklist(list.id, { note: note.trim() || null, docUrl: docUrl.trim() || null }))
                .then(() => setSaved(true));
            }}
          >
            Сохранить инструкцию
          </ActionButton>
          {dirty ? (
            <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--destructive_text_color)" }}>
              Не сохранено — нажми «Сохранить инструкцию».
            </span>
          ) : (
            saved && <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>Сохранено.</span>
          )}

          <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", lineHeight: 1.45 }}>
            {list.hasDoc
              ? `📄 Приложен файл: ${list.docName} — уходит дежурному вместе с чек-листом.`
              : "Файл не приложен."}
          </span>
          {/* Файл выбирается прямо здесь; путь через бота остаётся вторым — он
              короче, когда файл уже лежит в телефоне. */}
          <input
            ref={fileInput}
            type="file"
            style={{ display: "none" }}
            disabled={busy}
            aria-label={`Приложить файл к «${list.name}»`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Значение поля сбрасывается: иначе повторный выбор ТОГО ЖЕ файла
              // (после неудачи) не даёт события change вовсе.
              e.target.value = "";
              if (file) void run(() => apiClient.uploadChecklistDoc(list.id, file));
            }}
          />
          <ActionButton disabled={busy} onClick={() => fileInput.current?.click()}>
            {list.hasDoc ? "📎 Заменить файл" : "📎 Приложить файл"}
          </ActionButton>
          <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
            До 5 МБ. Можно и прислать боту: /instruction, потом выбрать «{list.name}».
          </span>
          {list.hasDoc && (
            <ActionButton kind="quiet" disabled={busy} onClick={() => void run(() => apiClient.removeChecklistDoc(list.id))}>
              Убрать файл
            </ActionButton>
          )}

          <ConfirmButton
            label="Удалить чек-лист"
            question={`Удалить «${list.name}» со всеми пунктами? Дежурные перестанут его получать.`}
            confirmLabel="Да, удалить"
            mode="plain"
            disabled={busy}
            onConfirm={() => void run(() => apiClient.deleteChecklist(list.id))}
          />
        </div>
      )}
    </Card>
  );
}

/**
 * Пункт чек-листа: правка названия и пояснения, перестановка, «Убрать».
 *
 * Раньше в мини-аппе пункт можно было только убрать: опечатку в названии
 * чинили «убрать и добавить заново», и пункт уезжал в конец списка, а порядок
 * обхода — это порядок пунктов в сообщении дежурному. Консоль это умела всегда
 * (`admin/src/screens/ChecklistScreen.tsx`).
 *
 * Название и пояснение правятся одной формой, а не двумя кнопками, как в
 * консоли: на телефоне в строке нет места под «Переименовать» и «Пояснение»
 * рядом со стрелками. В запрос уходит только изменённое — нетронутое поле не
 * должно перезаписываться тем, что было на экране при открытии формы.
 */
function ItemRow({
  item,
  index,
  total,
  busy,
  onSave,
  onMove,
  onRemove,
}: {
  item: ChecklistItem;
  index: number;
  total: number;
  busy: boolean;
  onSave: (patch: { title?: string; note?: string | null }) => Promise<boolean>;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note ?? "");

  function open() {
    setTitle(item.title);
    setNote(item.note ?? "");
    setEditing(true);
  }

  const patch: { title?: string; note?: string | null } = {};
  if (title.trim() && title.trim() !== item.title) patch.title = title.trim();
  if ((note.trim() || null) !== (item.note ?? null)) patch.note = note.trim() || null;
  const changed = Object.keys(patch).length > 0;

  if (editing) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Input header={`Пункт ${index + 1}`} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          header="Пояснение — как именно проверять"
          placeholder="Необязательно"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
        <div style={{ display: "flex", gap: 8 }}>
          {/* Обычная: `primary` в раскрытой карточке — «Сохранить инструкцию». */}
          <ActionButton
            compact
            disabled={busy || !changed}
            onClick={() => void onSave(patch).then((ok) => ok && setEditing(false))}
          >
            Сохранить
          </ActionButton>
          <ActionButton compact kind="quiet" disabled={busy} onClick={() => setEditing(false)}>
            Отмена
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
      <span style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", minWidth: 16 }}>{index + 1}</span>
      {/* Базис 140px: на узком экране кнопки уходят строкой ниже, а не
          сжимают название до пары букв. */}
      <span style={{ flex: "1 1 140px", fontSize: "var(--app-text-body)", minWidth: 0, overflowWrap: "anywhere" }}>
        {item.title}
        {item.note && (
          <span style={{ display: "block", fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>{item.note}</span>
        )}
      </span>
      <span style={{ display: "inline-flex", gap: 2, marginLeft: "auto", flex: "none" }}>
        <ActionButton compact kind="quiet" aria-label="Выше" disabled={busy || index === 0} onClick={() => onMove(index - 1)}>
          ↑
        </ActionButton>
        <ActionButton compact kind="quiet" aria-label="Ниже" disabled={busy || index === total - 1} onClick={() => onMove(index + 1)}>
          ↓
        </ActionButton>
        <ActionButton compact kind="quiet" aria-label="Изменить пункт" disabled={busy} onClick={open}>
          ✎
        </ActionButton>
        <ActionButton compact kind="quiet" disabled={busy} onClick={onRemove}>
          Убрать
        </ActionButton>
      </span>
    </div>
  );
}
