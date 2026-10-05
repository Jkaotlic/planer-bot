import { useTelegramBack } from "../lib/telegram-back";
import { ActionButton, Card, Group } from "../ui";
import { ConfirmButton } from "../components/ConfirmButton";
import { useEffect, useState } from "react";
import { Cell, IconButton, Input, Placeholder } from "@telegram-apps/telegram-ui";
import { selfEntryEditRefusal, selfEntryRefusal } from "@planer/shared";
import type { HandoverDraft, SelfEntryInput, Shift, Template } from "../api/client";
import type { Category } from "../categories";
import { DayBadge } from "../components/DayBadge";
import { EntryChip } from "../components/EntryChip";
import { formatTimeRange } from "../lib/shift";

/** Какую из трёх форм открыли. Категория — производная, см. `categoryOf`.
 *  «shift» — своя смена наблюдателя, третья форма поверх исходных двух. */
export type SelfEntryMode = "sick" | "event" | "shift";

function categoryOf(mode: SelfEntryMode): Category {
  if (mode === "sick") return "sick_leave";
  if (mode === "shift") return "shift";
  return "offsite";
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
  return value === "sick" || value === "event" || value === "shift" ? value : null;
}

/**
 * Кнопка «🤝 Выбрать коллег» из письма об ОК админа. Своя функция, а не ещё одно
 * значение `SelfEntryMode`: форма та же — больничный, — а ссылка говорит, что её
 * второй шаг надо поднять с сервера, потому что человек давно ушёл из формы.
 */
export function handoverDraftsFromSearch(search: string): boolean {
  return new URLSearchParams(search).get("screen") === "handovers";
}

/**
 * Свёрнута ли форма. По ссылке «Выбрать коллег» человек пришёл за вторым шагом, а
 * поля даты и «Поставить больничный» занимали ~440px над черновиками: первая
 * кнопка-кандидат оказывалась на 870px при экране 844 (замер 390×844). В этом
 * режиме форма — одна кнопка под черновиками, пока её не раскрыли или не нажали
 * «Изменить».
 */
export function selfEntryFormFolded({ draftsLink, expanded }: { draftsLink: boolean; expanded: boolean }): boolean {
  return draftsLink && !expanded;
}

/**
 * Свои записи, которые человеку ещё можно тронуть, ближайшие сверху.
 *
 * Спрашиваем ту же `selfEntryEditRefusal`, что решает на сервере, а не
 * повторяем условие «не кончилась» здесь: экран, показывающий кнопку «Изменить»
 * там, где сервер ответит отказом, — наблюдаемый дефект, а не расхождение
 * вкусов. Отдельной ручки под этот список нет намеренно: всё нужное уже приехало
 * с «Моими сменами».
 *
 * `ownShifts` — тот же флаг, что решает `selfEntryRefusal` на сервере: без него
 * `selfEntryEditRefusal` не признаёт категорию «shift» вообще, и своя смена
 * наблюдателя молча выпала бы из списка — не «показали отказ», а «сделали вид,
 * что записи не существует».
 */
export function mySelfEntries<T extends { category: Category; date: string; endDate: string | null }>(
  shifts: readonly T[],
  today: string,
  access: { ownShifts?: boolean } = {},
): T[] {
  return shifts
    .filter((entry) => selfEntryEditRefusal(entry, today, access) === null)
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
  /** `canAddOwnShifts(me)` — открывает категорию «shift» для `selfEntryRefusal`
   *  и `selfEntryEditRefusal`. Работнику всегда `false`: у него формы «shift»
   *  просто нет, но тот же расчёт отказа не должен молча решать за него иначе,
   *  чем решит сервер. */
  ownShifts: boolean;
  onCancel: () => void;
  /** Возвращает смены, оставшиеся без человека, — про них форма спросит вторым шагом. */
  onCreate: (input: SelfEntryInput) => Promise<HandoverDraft[]>;
  onUpdate: (id: number, input: SelfEntryInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onOfferHandover: (handoverId: number, toEmployeeId: number) => Promise<void>;
  onSkipHandover: (handoverId: number) => Promise<void>;
  /** Ссылка из письма об ОК: черновики передачи поднимаются с сервера при открытии. */
  loadDrafts?: () => Promise<HandoverDraft[]>;
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
  ownShifts,
  onCancel,
  onCreate,
  onUpdate,
  onDelete,
  onOfferHandover,
  onSkipHandover,
  loadDrafts,
}: SelfEntryScreenProps) {
  // Смены, оставшиеся без человека. Пока список не пуст, форма не закрывается:
  // это единственный момент, когда человек ещё помнит, кого можно попросить.
  const [drafts, setDrafts] = useState<HandoverDraft[]>([]);
  const [handoverBusy, setHandoverBusy] = useState(false);
  // Черновики после ОК — с сервера, один раз на открытие. Пусто — сказать словами:
  // пустая форма больничного по кнопке «Выбрать коллег» выглядела бы поломкой.
  const [draftsGone, setDraftsGone] = useState(false);
  useEffect(() => {
    if (!loadDrafts) return;
    let cancelled = false;
    loadDrafts().then(
      (loaded) => {
        if (cancelled) return;
        setDrafts(loaded);
        setDraftsGone(loaded.length === 0);
      },
      (err: unknown) => {
        if (!cancelled) setError(describeError(err));
      },
    );
    return () => {
      cancelled = true;
    };
    // Один раз на монтирование: ссылка — одна.
  }, []);
  // «Назад» с неотданной сменой сначала говорит, что будет, — второе нажатие
  // уходит. Смена не пропадёт (через три часа спросим всех), но человек должен
  // это знать, а не думать, что просто закрыл форму.
  const [leaveWarned, setLeaveWarned] = useState(false);
  function handleBack() {
    if (drafts.length > 0 && !leaveWarned) {
      setLeaveWarned(true);
      return;
    }
    onCancel();
  }

  // Системный «назад» Telegram — туда же, куда стрелка, с тем же
  // предупреждением о неотданной смене.
  useTelegramBack(handleBack);

  // Раскрыл ли человек форму сам; значим только при ссылке «Выбрать коллег» (`loadDrafts`).
  const [formExpanded, setFormExpanded] = useState(false);
  const formFolded = selfEntryFormFolded({ draftsLink: !!loadDrafts, expanded: formExpanded });
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
  const isShift = category === "shift";
  const mine = mySelfEntries(shifts, today, { ownShifts });

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
    // Правка без полей невозможна — раскрываем.
    setFormExpanded(true);
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
    if (isSick) return { category: "sick_leave", date, endDate: endDate || null };
    if (isShift) return { category: "shift", date, start, end, location: location.trim() || null };
    return { category: "offsite", date, start, end, title: title.trim(), location: location.trim() || null };
  }

  /** Причина отказа до запроса — та же функция, что решит на сервере. Тот же
   *  `ownShifts`, что открывает категорию «shift» в списке ниже: без него
   *  своя смена наблюдателя получила бы «Такую запись ставит админ» даже с
   *  включённым тумблером. */
  const refusal = selfEntryRefusal({ category, date, endDate: isSick ? endDate || null : null }, today, { ownShifts });
  const titleMissing = category === "offsite" && title.trim().length === 0;
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
    <div className="ui-screen ui-screen--overlay">
      {/* Корень и «Назад» свои, а не `Screen onBack`: у экрана своя логика выхода с
          предупреждением, и вторая подписка на системную кнопку задвоила бы её. */}
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* 44px, а не 38 у `size="l"`: зона нажатия «Назад» — как у остальных кнопок. */}
        <IconButton mode="plain" size="l" aria-label="Назад" style={{ minWidth: 44, minHeight: 44 }} onClick={handleBack}>
          <BackIcon />
        </IconButton>
        <h1 className="ui-screen__title">
          {isSick ? "Больничный" : isShift ? "Смена" : "Мероприятие"}
        </h1>
      </header>

      {!formFolded && (
        <>
        <Group
          header={editingId != null ? "Меняем запись" : isSick ? "Когда болеешь" : isShift ? "Когда и где" : "Что и когда"}
          footer={
            isSick
              ? "Админам уйдёт письмо: они подтвердят больничный и увидят, какие смены остались без человека."
              : isShift
                ? "Смена появится в общем графике команды — как обычная, просто её поставил не админ."
                : "Место заполняют, если мероприятие выездное. В офисе — можно не заполнять."
          }
        >
          <Card>
            {category === "offsite" && (
              <Input
                header="Название"
                placeholder="Например: конференция"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
            <Input header={isSick ? "С какого" : "Дата"} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            {isSick ? (
              <Input
                header="По какое (если знаешь)"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            ) : (
              <>
                <div style={{ display: "flex", gap: 8 }}>
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
                <Input
                  header="Место (необязательно)"
                  placeholder="Адрес или площадка"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </>
            )}
          </Card>
        </Group>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Отказ и ошибка — рядом с кнопкой, а не в шапке: мини-апп это один
              длинный скролл без единого `position: fixed`, и сообщение, отрисованное
              вверху по нажатию внизу, человеку невидимо. */}
          {(error ?? refusal) && (
            <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>
              {error ?? refusal}
            </div>
          )}
          <ActionButton stretched kind="primary" loading={submitting} disabled={submitting || !!refusal} onClick={() => void handleSubmit()}>
            {editingId != null ? "Сохранить" : isSick ? "Поставить больничный" : isShift ? "Поставить себе смену" : "Записать мероприятие"}
          </ActionButton>
          {editingId != null && (
            <ActionButton stretched kind="quiet" onClick={resetForm}>
              Отменить правку
            </ActionButton>
          )}
        </div>
        </>
      )}

      {draftsGone && drafts.length === 0 && (
        <div role="status" style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>
          Смен для передачи не осталось — их уже взяли или предложили всем свободным.
        </div>
      )}
      {drafts.length > 0 && leaveWarned && (
        <div role="status" style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--destructive_text_color)" }}>
          Смена ещё не отдана. Если выйти — через три часа спросим всех свободных. Нажми «Назад» ещё раз, чтобы выйти.
        </div>
      )}
      {drafts.length > 0 && (
        <>
          {drafts.map((draft) => (
            <Group
              key={draft.id}
              header="Кому предложить смену"
              footer="Не ответит за три часа — спросим всех свободных. Если никто не выйдет, за 12 часов до смены напишем админам."
            >
              <Card flush>
                <Cell multiline>{draft.shiftLine}</Cell>
                {draft.candidates.length === 0 ? (
                  <Placeholder description="Свободных нет — админы уже знают, что смена без человека." />
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 12 }}>
                    {draft.candidates.map((candidate) => (
                      <ActionButton
                        key={candidate.id}
                        compact
                        disabled={handoverBusy}
                        onClick={() => void resolveDraft(draft.id, () => onOfferHandover(draft.id, candidate.id))}
                      >
                        {candidate.displayName}
                      </ActionButton>
                    ))}
                  </div>
                )}
                <div style={{ padding: "0 12px 12px" }}>
                  <ActionButton
                    stretched
                    kind="quiet"
                    disabled={handoverBusy}
                    onClick={() => void resolveDraft(draft.id, () => onSkipHandover(draft.id))}
                  >
                    {/* Называлась «Потом», а сервер сразу пишет всем свободным —
                        название обещало обратное тому, что делает. Без свободных
                        спрашивать некого: админы уже знают, остаётся закрыть. */}
                    {draft.candidates.length === 0 ? "Понятно" : "Спросить всех свободных"}
                  </ActionButton>
                </div>
              </Card>
            </Group>
          ))}
        </>
      )}

      {formFolded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Ошибка загрузки черновиков живёт в блоке формы, а он свёрнут: без неё
              сломанная ссылка выглядела бы пустым экраном. */}
          {error && (
            <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>
          )}
          <ActionButton stretched kind="quiet" onClick={() => setFormExpanded(true)}>
            Записать ещё один больничный
          </ActionButton>
        </div>
      )}

      {/* Вместо черновиков передачи (их нет, пока нет ОК) — что будет дальше. Рядом
          со списком, а не вверху: экран — один длинный скролл. */}
      {mine.some((entry) => entry.category === "sick_leave" && entry.pending) && (
        <div role="status" style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)" }}>
          Больничный ждёт ОК. Админы подтвердят — после этого предложим твои смены коллегам.
        </div>
      )}

      <Group header="Что ты уже записал себе" footer="Здесь только то, что ещё не кончилось: прошедшее правит админ.">
        <Card flush>
          {mine.length === 0 ? (
            <Placeholder description={formFolded ? "Пока ничего." : "Пока ничего. Заполни форму выше."} />
          ) : (
            mine.map((entry) => (
              <Cell
                key={entry.id}
                before={<DayBadge date={entry.date} endDate={entry.endDate} />}
                subtitle={formatTimeRange(entry)}
                // Кнопки под чипом, а не в `after`: справа они оставляли описанию ~108px
                // (замер 390px), а «Больничный · ждёт ОК» просит 178.8 — чип обрезался,
                // а «Изменить»/«Снять» сжимались до 45.6/36.9px с вертикальным текстом.
                description={
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, paddingTop: 2 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <EntryChip entry={entry} templates={templates} />
                      {entry.location && <span>{entry.location}</span>}
                    </span>
                    {/* 44px по высоте, как были кнопки в `after` (замер 44.5): compact рисует 36,
                        а строка и без того высокая — лишние 8px зону нажатия не портят. */}
                    <span style={{ display: "flex", gap: 6, minHeight: "var(--app-tap)" }}>
                      <ActionButton compact onClick={() => startEditing(entry)}>
                        Изменить
                      </ActionButton>
                      <ConfirmButton
                        label="Снять"
                        question="Снять эту запись? Админам придёт письмо."
                        confirmLabel="Да, снять"
                        mode="plain"
                        loading={busyId === entry.id}
                        disabled={busyId != null}
                        onConfirm={() => void handleDelete(entry.id)}
                      />
                    </span>
                  </span>
                }
              >
                {entry.title ?? (entry.category === "sick_leave" ? "Больничный" : entry.category === "shift" ? "Смена" : "Мероприятие")}
              </Cell>
            ))
          )}
        </Card>
      </Group>
    </div>
  );
}

function BackIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
