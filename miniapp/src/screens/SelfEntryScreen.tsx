import { useState } from "react";
import { Button, Cell, IconButton, Input, List, Placeholder, Section, Title } from "@telegram-apps/telegram-ui";
import { selfEntryEditRefusal, selfEntryRefusal } from "@planer/shared";
import type { HandoverDraft, SelfEntryInput, Shift, Template } from "../api/client";
import type { Category } from "../categories";
import { DayBadge } from "../components/DayBadge";
import { EntryChip } from "../components/EntryChip";
import { ScreenScroll } from "../components/ScreenScroll";
import { formatTimeRange } from "../lib/shift";

/** Какую из двух форм открыли. Категория — производная, см. `categoryOf`. */
export type SelfEntryMode = "sick" | "event";

function categoryOf(mode: SelfEntryMode): Category {
  return mode === "sick" ? "sick_leave" : "offsite";
}

/**
 * Конец мероприятия по его началу.
 *
 * Владелец просил у формы только время начала. Конец всё равно обязателен —
 * запись без него не участвует в проверке пересечений и висит в балансе нулём,
 * то есть попадает в тот же сорт, что нечитаемая ячейка ростера. Поэтому поле
 * есть, но заполнено заранее: согласен — не трогаешь.
 *
 * Упор в 23:59, а не переход через полночь: форма однодневная, и «01:30»
 * молча создало бы перевёрнутый диапазон, который сервер тут же отвергнет.
 */
export function defaultEventEnd(start: string): string {
  const [h, m] = start.split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return start;
  const minutes = h * 60 + m + 120;
  // Не переходим через полночь: форма однодневная.
  if (minutes >= 24 * 60) return "23:59";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Какую форму открыть сразу, если пришли по кнопке из бота.
 *
 * Строка запроса, а не фрагмент: фрагмент у мини-аппа занят самим Telegram —
 * initData приезжает именно в нём.
 */
export function screenFromSearch(search: string): SelfEntryMode | null {
  const value = new URLSearchParams(search).get("screen");
  return value === "sick" || value === "event" ? value : null;
}

/**
 * Свои записи, которые человеку ещё можно тронуть, ближайшие сверху.
 *
 * Спрашиваем ту же `selfEntryEditRefusal`, что решает на сервере, а не
 * повторяем условие «не кончилась» здесь: экран, показывающий кнопку «Изменить»
 * там, где сервер ответит отказом, — наблюдаемый дефект, а не расхождение
 * вкусов. Отдельной ручки под этот список нет намеренно: всё нужное уже приехало
 * с «Моими сменами».
 */
export function mySelfEntries<T extends { category: Category; date: string; endDate: string | null }>(
  shifts: readonly T[],
  today: string,
): T[] {
  return shifts
    .filter((entry) => selfEntryEditRefusal(entry, today) === null)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Ответы сервера, у которых текст — код, а не фраза для человека.
 *
 * Отказы правила приезжают уже по-русски (`selfEntryRefusal` пишет их сама), и
 * их видно как есть — иначе таблицу пришлось бы держать в двух местах и
 * синхронизировать руками.
 */
const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Проверь поля — что-то заполнено не так.",
  not_found: "Запись не найдена — возможно, её уже изменил админ. Обнови экран.",
};

function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (ERROR_MESSAGES[raw]) return ERROR_MESSAGES[raw];
  // Кириллица в тексте значит, что это фраза правила, а не код и не «Request to
  // /api/… failed with status 502»: такое человеку показывать нельзя.
  return /[а-яё]/i.test(raw) ? raw : "Не получилось сохранить. Попробуй ещё раз.";
}

export interface SelfEntryScreenProps {
  mode: SelfEntryMode;
  /** Сегодня в часовом поясе команды — пришло с «моими сменами», не `new Date()`. */
  today: string;
  /** Мои ближайшие записи целиком: список внизу выбирает из них свои. */
  shifts: readonly Shift[];
  templates: readonly Template[];
  onCancel: () => void;
  /** Возвращает смены, оставшиеся без человека, — про них форма спросит вторым шагом. */
  onCreate: (input: SelfEntryInput) => Promise<HandoverDraft[]>;
  onUpdate: (id: number, input: SelfEntryInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onOfferHandover: (handoverId: number, toEmployeeId: number) => Promise<void>;
  onSkipHandover: (handoverId: number) => Promise<void>;
}

/**
 * «Больничный» и «Мероприятие» — оверлей поверх «Моих смен», как «Предложить
 * обмен»: не вкладка, со своей кнопкой «назад».
 *
 * Один компонент на две формы, потому что всё вокруг полей у них общее — список
 * своих записей, правка, удаление и разбор ответа сервера. Развести их в два
 * экрана значило бы держать две копии этого всего.
 */
export function SelfEntryScreen({
  mode,
  today,
  shifts,
  templates,
  onCancel,
  onCreate,
  onUpdate,
  onDelete,
  onOfferHandover,
  onSkipHandover,
}: SelfEntryScreenProps) {
  // Смены, оставшиеся без человека. Пока список не пуст, форма не закрывается:
  // это единственный момент, когда человек ещё помнит, кого можно попросить.
  const [drafts, setDrafts] = useState<HandoverDraft[]>([]);
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  // Категория формы: у правки — та, что у самой записи, иначе та, ради которой
  // экран открыли. Иначе, начав править мероприятие из формы больничного,
  // человек увидел бы поля не от той записи.
  const [category, setCategory] = useState<Category>(categoryOf(mode));
  const [date, setDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState(defaultEventEnd("10:00"));
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSick = category === "sick_leave";
  const mine = mySelfEntries(shifts, today);

  function resetForm() {
    setEditingId(null);
    setCategory(categoryOf(mode));
    setDate(today);
    setEndDate("");
    setStart("10:00");
    setEnd(defaultEventEnd("10:00"));
    setTitle("");
    setLocation("");
    setError(null);
  }

  function startEditing(entry: Shift) {
    setEditingId(entry.id);
    setCategory(entry.category);
    setDate(entry.date);
    setEndDate(entry.endDate ?? "");
    setStart(entry.start ?? "10:00");
    setEnd(entry.end ?? defaultEventEnd(entry.start ?? "10:00"));
    setTitle(entry.title ?? "");
    setLocation(entry.location ?? "");
    setError(null);
  }

  function draft(): SelfEntryInput {
    return isSick
      ? { category: "sick_leave", date, endDate: endDate || null }
      : { category: "offsite", date, start, end, title: title.trim(), location: location.trim() || null };
  }

  /** Причина отказа до запроса — та же функция, что решит на сервере. */
  const refusal = selfEntryRefusal({ category, date, endDate: isSick ? endDate || null : null }, today);
  const titleMissing = !isSick && title.trim().length === 0;
  const rangeInverted = isSick && !!endDate && endDate < date;
  const timesInverted = !isSick && end <= start;

  async function handleSubmit() {
    if (submitting) return;
    if (refusal) return setError(refusal);
    if (titleMissing) return setError("Назови мероприятие — иначе админ не поймёт, что это.");
    if (rangeInverted) return setError("«По» раньше, чем «с».");
    if (timesInverted) return setError("Конец раньше начала.");
    setSubmitting(true);
    setError(null);
    try {
      if (editingId != null) {
        await onUpdate(editingId, draft());
      } else {
        const uncovered = await onCreate(draft());
        setDrafts(uncovered);
      }
      resetForm();
    } catch (err) {
      console.error("Self entry save failed:", err);
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Смена ушла — либо конкретному человеку, либо в веер.
   *
   * Строка убирается со экрана только после успеха: иначе человек, у которого
   * запрос не прошёл, увидел бы пустой экран и решил, что смену кто-то принял.
   */
  async function resolveDraft(handoverId: number, action: () => Promise<void>) {
    if (handoverBusy) return;
    setHandoverBusy(true);
    setError(null);
    try {
      await action();
      setDrafts((prev) => prev.filter((draft) => draft.id !== handoverId));
    } catch (err) {
      console.error("Handover action failed:", err);
      setError(describeError(err));
    } finally {
      setHandoverBusy(false);
    }
  }

  async function handleDelete(id: number) {
    if (busyId != null) return;
    setBusyId(id);
    setError(null);
    try {
      await onDelete(id);
      if (editingId === id) resetForm();
    } catch (err) {
      console.error("Self entry delete failed:", err);
      setError(describeError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScreenScroll>
      <header style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 4px 16px" }}>
        <IconButton mode="plain" size="m" aria-label="Назад" onClick={onCancel}>
          <BackIcon />
        </IconButton>
        <Title level="2" weight="2">
          {isSick ? "Больничный" : "Мероприятие"}
        </Title>
      </header>

      <List>
        <Section
          header={editingId != null ? "Меняем запись" : isSick ? "Когда болеешь" : "Что и когда"}
          footer={
            isSick
              ? "Админам уйдёт письмо: они увидят, какие смены остались без человека."
              : "Место заполняют, если мероприятие выездное. В офисе — можно не заполнять."
          }
        >
          {!isSick && (
            <div style={{ padding: "2px 12px 8px" }}>
              <Input
                header="Название"
                placeholder="Например: конференция"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          )}
          <div style={{ padding: "2px 12px 8px" }}>
            <Input header={isSick ? "С какого" : "Дата"} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {isSick ? (
            <div style={{ padding: "2px 12px 8px" }}>
              <Input
                header="По какое (если знаешь)"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, padding: "2px 12px 8px" }}>
                <Input
                  header="Начало"
                  type="time"
                  value={start}
                  onChange={(e) => {
                    const next = e.target.value;
                    setStart(next);
                    // Конец тянется за началом, пока его не трогали руками —
                    // человек, поменявший начало, почти всегда двигает и конец.
                    if (end === defaultEventEnd(start)) setEnd(defaultEventEnd(next));
                  }}
                />
                <Input header="Конец" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div style={{ padding: "2px 12px 8px" }}>
                <Input
                  header="Место (необязательно)"
                  placeholder="Адрес или площадка"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
            </>
          )}
        </Section>
      </List>

      <div style={{ padding: "6px 4px 18px" }}>
        {/* Отказ и ошибка — рядом с кнопкой, а не в шапке: мини-апп это один
            длинный скролл без единого `position: fixed`, и сообщение, отрисованное
            вверху по нажатию внизу, человеку невидимо. */}
        {(error ?? refusal) && (
          <div style={{ padding: "0 8px 8px", color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>
            {error ?? refusal}
          </div>
        )}
        <Button size="l" stretched mode="filled" loading={submitting} disabled={submitting || !!refusal} onClick={() => void handleSubmit()}>
          {editingId != null ? "Сохранить" : isSick ? "Поставить больничный" : "Записать мероприятие"}
        </Button>
        {editingId != null && (
          <div style={{ paddingTop: 8 }}>
            <Button size="m" stretched mode="plain" onClick={resetForm}>
              Отменить правку
            </Button>
          </div>
        )}
      </div>

      {drafts.length > 0 && (
        <List>
          {drafts.map((draft) => (
            <Section
              key={draft.id}
              header="Кому предложить смену"
              footer="Не ответит за три часа — спросим всех свободных. Если никто не выйдет, за 12 часов до смены напишем админам."
            >
              <Cell multiline>{draft.shiftLine}</Cell>
              {draft.candidates.length === 0 ? (
                <Placeholder description="Свободных нет — админы уже знают, что смена без человека." />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 12px 10px" }}>
                  {draft.candidates.map((candidate) => (
                    <Button
                      key={candidate.id}
                      size="s"
                      mode="bezeled"
                      disabled={handoverBusy}
                      onClick={() => void resolveDraft(draft.id, () => onOfferHandover(draft.id, candidate.id))}
                    >
                      {candidate.displayName}
                    </Button>
                  ))}
                </div>
              )}
              <div style={{ padding: "0 12px 12px" }}>
                <Button
                  size="m"
                  stretched
                  mode="plain"
                  disabled={handoverBusy}
                  onClick={() => void resolveDraft(draft.id, () => onSkipHandover(draft.id))}
                >
                  Потом
                </Button>
              </div>
            </Section>
          ))}
        </List>
      )}

      <List>
        <Section header="Что ты уже записал себе" footer="Здесь только то, что ещё не кончилось: прошедшее правит админ.">
          {mine.length === 0 ? (
            <Placeholder description="Пока ничего. Заполни форму выше." />
          ) : (
            mine.map((entry) => (
              <Cell
                key={entry.id}
                before={<DayBadge date={entry.date} endDate={entry.endDate} />}
                subtitle={formatTimeRange(entry)}
                description={
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <EntryChip entry={entry} templates={templates} />
                    {entry.location && <span>{entry.location}</span>}
                  </span>
                }
                after={
                  <span style={{ display: "flex", gap: 6 }}>
                    <Button size="s" mode="bezeled" onClick={() => startEditing(entry)}>
                      Изменить
                    </Button>
                    <Button
                      size="s"
                      mode="plain"
                      loading={busyId === entry.id}
                      disabled={busyId != null}
                      onClick={() => void handleDelete(entry.id)}
                    >
                      Снять
                    </Button>
                  </span>
                }
              >
                {entry.title ?? (entry.category === "sick_leave" ? "Больничный" : "Мероприятие")}
              </Cell>
            ))
          )}
        </Section>
      </List>
    </ScreenScroll>
  );
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
