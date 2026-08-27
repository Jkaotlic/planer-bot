import { useEffect, useState } from "react";
import {
  collectionStatus,
  describeDaysUntil,
  formatDayMonth,
  formatMoney,
  isCollectionActive,
} from "@planer/shared";
import {
  apiClient,
  AuthRequiredError,
  type Collection,
  type CollectionPatch,
  type CollectionPreview,
  type CollectionRow,
  type Employee,
  type PaymentRow,
  type UpcomingBirthday,
} from "../api/client";
import { CollapsibleArchive } from "../components/CollapsibleArchive";
import { PersonPicker } from "../components/PersonPicker";
import { initialsOf, personPalette } from "../lib/people";
import { withNotifyNotice } from "../lib/notify-text";

/**
 * «Сборы»: деньги, которые команда скидывает — на день рождения или по любому
 * другому поводу.
 *
 * The rule the screen is built around — **the bot never mails the team on its
 * own.** A week ahead it nudges the admins; everything after that happens here,
 * by hand: paste the Сбербанк link, edit the wording if you like, look at the
 * exact text and the exact list of names, and only then send. The send button
 * asks once more before it fires, because it is the one action in this console
 * that writes to every colleague at once.
 *
 * Второе правило — **сюрприз**: сбор, где смотрящий виновник, сервер не
 * отдаёт вообще. Экран его не прячет — прятать уже нечего.
 *
 * Хелперы ниже дублируют мини-апповские намеренно: консоль и мини-апп не
 * импортируют друг у друга ничего, а общие правила лежат в `@planer/shared` и
 * берутся оттуда.
 */

/** How near counts as «ближайшие» — a month is roughly when a collection starts. */
const SOON_DAYS = 30;

export type StatusTone = "sent" | "ready" | "pending";

/**
 * The chip on the right of a row: where this collection has got to.
 *
 * Закрытый читается закрытым, а не «Разослано»: в закрытом уже ничего не
 * происходит, и чип про рассылку звал бы дожимать собранное.
 */
export function statusOf(row: Pick<CollectionRow, "collection" | "status" | "active">): { label: string; tone: StatusTone } {
  if (!row.active) return { label: "Закрыт", tone: "pending" };
  if (row.status === "sent") return { label: `Разослано · ${row.collection.sentCount}`, tone: "sent" };
  if (row.status === "ready") return { label: "Готово к отправке", tone: "ready" };
  return { label: "Нет ссылки на сбор", tone: "pending" };
}

/**
 * Тот же чип для раунда дня рождения из списка ближайших.
 *
 * У списка ближайших нет строки, посчитанной сервером: там лежит сама запись,
 * а пока раунд не сохранён ни разу — ничего. Статус и активность считаются
 * теми же функциями `@planer/shared`, что и на сервере.
 */
export function roundStatus(campaign: Collection | null, today: string): { label: string; tone: StatusTone } {
  if (!campaign) return { label: "Нет ссылки на сбор", tone: "pending" };
  return statusOf({
    collection: campaign,
    status: collectionStatus(campaign),
    active: isCollectionActive(campaign, today),
  });
}

/** "5 августа · через 4 дня" — the date, and how far off it is. */
export function whenLabel(birthday: UpcomingBirthday): string {
  return `${birthday.birthDateLabel} · ${describeDaysUntil(birthday.daysUntil)}`;
}

/**
 * "1 коллеге" / "5 коллегам" / "21 коллеге" — the dative the send button is
 * written in. The dative has no 2–4 vs 5+ split (unlike `recipientsSubject`
 * below) — only "ends in 1, except 11" gets the singular. Before this rule
 * had the "except 11" half, a team of 21 read "Отправить 21 коллегам?".
 */
export function recipientsPhrase(count: number): string {
  const singular = count % 10 === 1 && count % 100 !== 11;
  return `${count} ${singular ? "коллеге" : "коллегам"}`;
}

/**
 * "1 коллега" / "3 коллеги" / "5 коллег" — the nominative, for the line that
 * reads «Получат 3 коллеги». The two cases are separate functions on purpose:
 * «Получат 3 коллегам» is the mistake this prevents.
 */
export function recipientsSubject(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} коллег`;
  if (mod10 === 1) return `${count} коллега`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} коллеги`;
  return `${count} коллег`;
}

/** «по 1 000 ₽ · нужно 25 000 ₽» — только то, что заполнено. */
export function moneyLine(c: { amountPerPerson: number | null; totalGoal: number | null }): string | null {
  const parts: string[] = [];
  if (c.amountPerPerson != null) parts.push(`по ${formatMoney(c.amountPerPerson)}`);
  if (c.totalGoal != null) parts.push(`нужно ${formatMoney(c.totalGoal)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Повод из одних пробелов поводом не считается. */
export function canCreate(title: string): boolean {
  return title.trim().length > 0;
}

/**
 * Повод и виновник — одной фразой через тире, в именительном.
 *
 * Та же форма, что в письме команде (`collectionMessage`): «Свадьба — Пётр
 * Иванов». Сервер отдаёт их порознь, и одно «Свадьба» в списке из трёх сборов
 * не говорит, на кого он. Склонять нечем — в базе лежит только `display_name`.
 */
export function cardSubject(row: Pick<CollectionRow, "title" | "personName">): string {
  return row.personName ? `${row.title} — ${row.personName}` : row.title;
}

/**
 * Подпись кнопки отправки.
 *
 * Дожим обязан говорить, что рассылка уже была, и когда: иначе второе нажатие
 * выглядит как первое, и админ шлёт команде третье письмо, думая, что первое
 * не ушло.
 */
export function sendButtonLabel(preview: CollectionPreview): string {
  if (preview.sendCount === 0) return `Разослать ${recipientsPhrase(preview.recipients.length)}`;
  const when = preview.lastSentAt ? ` · рассылалось ${formatDayMonth(preview.lastSentAt.slice(0, 10))}` : "";
  return `Напомнить ещё раз${when}`;
}

/** Дедлайн главнее даты события — как в правиле активности. */
function edgeLine(c: Collection): string | null {
  if (c.deadline) return `до ${formatDayMonth(c.deadline)}`;
  if (c.eventDate) return formatDayMonth(c.eventDate);
  if (c.celebratedOn) return formatDayMonth(c.celebratedOn);
  return null;
}

/** Пустое поле — это «не задано», а не ноль: сервер знает разницу. */
function moneyValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/** Today, as the rules want it: `YYYY-MM-DD`, compared as a string. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function CollectionsScreen() {
  const today = todayIso();
  const [birthdays, setBirthdays] = useState<UpcomingBirthday[] | null>(null);
  const [rows, setRows] = useState<CollectionRow[] | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [openBirthday, setOpenBirthday] = useState<number | null>(null);
  const [openCollection, setOpenCollection] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reloadBirthdays() {
    try {
      setBirthdays(await apiClient.getBirthdays());
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Не удалось загрузить дни рождения");
    }
  }

  async function reloadCollections() {
    try {
      setRows(await apiClient.getCollections());
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setRowsError(err instanceof Error ? err.message : "Не удалось загрузить сборы");
    }
  }

  // Два списка пересекаются: один и тот же раунд читался бы «Готово» в одном и
  // «Разослано» в другом сразу после отправки, если перечитывать только один.
  async function reloadEverything() {
    await Promise.all([reloadBirthdays(), reloadCollections()]);
  }

  useEffect(() => {
    void reloadEverything();
    void (async () => {
      try {
        setEmployees(await apiClient.getEmployees());
      } catch {
        // Без списка работников форма всё ещё заводит общий сбор. Своей строки
        // ошибки нет намеренно: беда списков выше важнее.
      }
    })();
    // Loads once; every mutation below reloads explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error && !birthdays) return <div className="employees-error">{error}</div>;
  if (!birthdays) return <div className="employees-empty">Загрузка…</div>;

  const soon = birthdays.filter((b) => b.daysUntil <= SOON_DAYS);
  const later = birthdays.filter((b) => b.daysUntil > SOON_DAYS);

  // Живые и закрытые — двумя списками. Порядок внутри каждого остаётся серверным
  // (`compareCollections`), который и так держит закрытые в конце: фильтр по
  // `active` только разносит их по секциям, ничего не пересортировывая.
  const openRows = rows === null ? null : rows.filter((row) => row.active);
  const closedRows = rows === null ? [] : rows.filter((row) => !row.active);

  // Обработчики одни на оба списка: закрытый сбор открывают заново той же
  // карточкой, и две копии этих замыканий разъехались бы на первой же правке.
  const toggleCollection = (id: number) => {
    setNotice(null);
    setOpenCollection(openCollection === id ? null : id);
  };
  const handleSent = (row: CollectionRow, delivered: number, intended: number) => {
    setOpenCollection(null);
    const aside = row.personName ? ` ${row.personName} — не в списке.` : "";
    setNotice(withNotifyNotice(`Разослано ${recipientsPhrase(delivered)}.${aside}`, { delivered, intended }));
    void reloadEverything();
  };
  const handleDeleted = () => {
    setOpenCollection(null);
    setNotice("Сбор удалён.");
    void reloadEverything();
  };

  function renderRow(birthday: UpcomingBirthday) {
    return (
      <BirthdayRow
        key={birthday.employeeId}
        birthday={birthday}
        today={today}
        open={openBirthday === birthday.employeeId}
        onToggle={() => {
          setNotice(null);
          setOpenBirthday(openBirthday === birthday.employeeId ? null : birthday.employeeId);
        }}
        onChanged={reloadEverything}
        onSent={(delivered, intended) => {
          setOpenBirthday(null);
          setNotice(
            withNotifyNotice(
              `Разослано ${recipientsPhrase(delivered)}. ${birthday.displayName} — не в списке.`,
              { delivered, intended },
            ),
          );
          void reloadEverything();
        }}
      />
    );
  }

  return (
    <div className="employees-screen">
      <div className="employees-header">
        <h2 className="employees-title">Сборы</h2>
      </div>

      {error && <div className="employees-error">{error}</div>}
      {notice && <div className="birthday-notice">{notice}</div>}

      {/* Идущие сборы — первым делом, до всего остального. Экран открывают,
          чтобы посмотреть на них или разослать дожим, а календарь дней рождения
          на год вперёд — это справка, за которой сюда не ходят. Раньше порядок
          был обратный, и до живого сбора надо было прокрутить чужой год. */}
      <h3 className="birthday-group">Идут сборы</h3>
      <CollectionsList
        rows={openRows}
        error={rowsError}
        // Не «сборов пока не было», когда они были и все закрыты: список ниже
        // прямо противоречил бы этой фразе.
        emptyLabel={closedRows.length > 0 ? "Открытых сборов нет — закрытые ниже." : "Сборов пока не было."}
        employees={employees}
        openId={openCollection}
        onToggle={toggleCollection}
        onChanged={reloadEverything}
        onSent={handleSent}
        onDeleted={handleDeleted}
      />

      <h3 className="birthday-group">Новый сбор</h3>
      <NewCollectionForm
        employees={employees}
        onCreated={async (created) => {
          setNotice(null);
          await reloadEverything();
          // Консоль не знает, кто смотрит: JWT знает, а клиент — нет. Поэтому
          // сбор, заведённый на самого себя, ловится постфактум: сервер по
          // правилу сюрприза перестаёт его отдавать, и строка не появляется
          // в списке. Молча это выглядит как «кнопка не сработала».
          const visible = await apiClient.getCollections().catch(() => null);
          if (visible && !visible.some((r) => r.collection.id === created.id)) {
            setNotice(
              "Сбор создан, но он на тебя — по правилу сюрприза ты его не увидишь и не сможешь разослать. " +
                "Попроси другого админа.",
            );
          }
        }}
      />

      {/* Пояснение стоит над тем, что объясняет: оно про дни рождения, а не
          про экран целиком, и наверху читалось как вводная ко всей странице. */}
      <p className="birthday-intro">
        За неделю до дня рождения бот напишет админам. Команде ничего не уходит, пока ты сам не нажмёшь
        «Разослать» — и не увидишь перед этим точный текст и поимённый список.
      </p>

      <h3 className="birthday-group">Ближайшие дни рождения</h3>
      {birthdays.length === 0 ? (
        <div className="employees-empty">
          Ни у кого не указан день рождения — проставь даты на экране «Работники».
        </div>
      ) : (
        <>
          {soon.length === 0 ? (
            <div className="employees-empty">В ближайший месяц дней рождения нет.</div>
          ) : (
            <div className="employees-list">{soon.map(renderRow)}</div>
          )}

          {later.length > 0 && (
            <>
              <h3 className="birthday-group">Дальше по году</h3>
              <div className="employees-list">{later.map(renderRow)}</div>
            </>
          )}
        </>
      )}

      {/* Закрытые не мешают живым, но и не пропадают: их ещё открывают заново. */}
      <CollapsibleArchive title="Закрытые" items={closedRows}>
        {(closed) => (
          <CollectionsList
            rows={closed as CollectionRow[]}
            // Ошибка загрузки уже показана выше — второй раз тем же текстом незачем.
            error={null}
            emptyLabel="Сборов пока не было."
            employees={employees}
            openId={openCollection}
            onToggle={toggleCollection}
            onChanged={reloadEverything}
            onSent={handleSent}
            onDeleted={handleDeleted}
          />
        )}
      </CollapsibleArchive>
    </div>
  );
}

function NewCollectionForm({
  employees,
  onCreated,
}: {
  employees: Employee[];
  onCreated: (created: Collection) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [employeeId, setEmployeeId] = useState(0);
  const [eventDate, setEventDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [amountPerPerson, setAmountPerPerson] = useState("");
  const [totalGoal, setTotalGoal] = useState("");
  const [collectUrl, setCollectUrl] = useState("");
  const [messageText, setMessageText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setTitle("");
    setEmployeeId(0);
    setEventDate("");
    setDeadline("");
    setAmountPerPerson("");
    setTotalGoal("");
    setCollectUrl("");
    setMessageText("");
    setError(null);
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const created = await apiClient.createCollection({
        title: title.trim(),
        employeeId: employeeId === 0 ? null : employeeId,
        eventDate: eventDate || null,
        deadline: deadline || null,
        amountPerPerson: moneyValue(amountPerPerson),
        totalGoal: moneyValue(totalGoal),
        collectUrl: collectUrl.trim() || null,
        messageText: messageText.trim() || null,
      });
      reset();
      await onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать сбор");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="birthday-card">
      <div className="birthday-editor">
        <label className="birthday-label">
          Повод
          <input
            type="text"
            aria-label="Повод"
            placeholder="Например, Свадьба"
            value={title}
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        {/* Виновника можно не выбирать — это и есть общий сбор. */}
        <PersonPicker
          label="Кому"
          people={employees.filter((e) => e.isActive)}
          value={employeeId}
          onChange={setEmployeeId}
          emptyOptionLabel="Общий сбор — на всех"
          disabled={busy}
        />

        <CollectionFields
          busy={busy}
          eventDate={eventDate}
          deadline={deadline}
          amountPerPerson={amountPerPerson}
          totalGoal={totalGoal}
          collectUrl={collectUrl}
          messageText={messageText}
          onEventDate={setEventDate}
          onDeadline={setDeadline}
          onAmountPerPerson={setAmountPerPerson}
          onTotalGoal={setTotalGoal}
          onCollectUrl={setCollectUrl}
          onMessageText={setMessageText}
        />

        {error && <div className="employees-error">{error}</div>}

        <div className="journal-controls">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canCreate(title) || busy}
            onClick={() => void handleCreate()}
          >
            {busy ? "Создаю…" : "Создать"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Шесть полей, одинаковых в форме создания и в редакторе — чтобы созданный
 * сбор и открытый на правку не начали спрашивать разное.
 */
function CollectionFields({
  busy,
  eventDate,
  deadline,
  amountPerPerson,
  totalGoal,
  collectUrl,
  messageText,
  onEventDate,
  onDeadline,
  onAmountPerPerson,
  onTotalGoal,
  onCollectUrl,
  onMessageText,
}: {
  busy: boolean;
  eventDate: string;
  deadline: string;
  amountPerPerson: string;
  totalGoal: string;
  collectUrl: string;
  messageText: string;
  onEventDate: (v: string) => void;
  onDeadline: (v: string) => void;
  onAmountPerPerson: (v: string) => void;
  onTotalGoal: (v: string) => void;
  onCollectUrl: (v: string) => void;
  onMessageText: (v: string) => void;
}) {
  return (
    <>
      <div className="collection-form-row">
        <label className="birthday-label">
          Дата события
          <input type="date" aria-label="Дата события" value={eventDate} disabled={busy} onChange={(e) => onEventDate(e.target.value)} />
        </label>
        <label className="birthday-label">
          Скинуться до
          <input type="date" aria-label="Скинуться до" value={deadline} disabled={busy} onChange={(e) => onDeadline(e.target.value)} />
        </label>
      </div>

      <div className="collection-form-row">
        <label className="birthday-label">
          По сколько с человека, ₽
          <input
            type="number"
            inputMode="numeric"
            aria-label="По сколько с человека"
            value={amountPerPerson}
            disabled={busy}
            onChange={(e) => onAmountPerPerson(e.target.value)}
          />
        </label>
        <label className="birthday-label">
          Нужно всего, ₽
          <input
            type="number"
            inputMode="numeric"
            aria-label="Нужно всего"
            value={totalGoal}
            disabled={busy}
            onChange={(e) => onTotalGoal(e.target.value)}
          />
        </label>
      </div>

      <label className="birthday-label">
        Ссылка на сбор (Сбербанк Онлайн)
        <input
          type="url"
          aria-label="Ссылка на сбор"
          placeholder="https://..."
          value={collectUrl}
          disabled={busy}
          onChange={(e) => onCollectUrl(e.target.value)}
        />
      </label>

      {/* The placeholder is a hint, not the default text: the default is shown
          in full right below, and printing it twice just made it look editable. */}
      <label className="birthday-label">
        Свой текст — необязательно
        <textarea
          rows={4}
          aria-label="Свой текст"
          placeholder="Оставь пустым — уйдёт текст ниже"
          value={messageText}
          disabled={busy}
          onChange={(e) => onMessageText(e.target.value)}
        />
      </label>
    </>
  );
}

/**
 * Один список сборов — живых или закрытых, смотря что передали.
 *
 * Порядок задан сервером (`compareCollections` из `@planer/shared`), тем же,
 * что и в мини-аппе: два независимых `sort` — это два разных списка через
 * полгода. Разбивка на «живые» и «Закрытые» сделана фильтром на вызывающей
 * стороне и серверный порядок внутри каждой половины сохраняет.
 */
function CollectionsList({
  rows,
  error,
  emptyLabel,
  employees,
  openId,
  onToggle,
  onChanged,
  onSent,
  onDeleted,
}: {
  rows: CollectionRow[] | null;
  error: string | null;
  /** Что сказать на пустом списке. Приходит извне: «сборов не было» и «открытых нет» — разные правды. */
  emptyLabel: string;
  employees: Employee[];
  openId: number | null;
  onToggle: (id: number) => void;
  onChanged: () => Promise<void>;
  onSent: (row: CollectionRow, delivered: number, intended: number) => void;
  onDeleted: () => void;
}) {
  if (error) return <div className="employees-error">{error}</div>;
  if (!rows) return <div className="employees-empty">Загрузка…</div>;
  if (rows.length === 0) return <div className="employees-empty">{emptyLabel}</div>;

  return (
    <div className="employees-list">
      {rows.map((row) => (
        <CollectionCard
          key={row.collection.id}
          row={row}
          employees={employees}
          open={openId === row.collection.id}
          onToggle={() => onToggle(row.collection.id)}
          onChanged={onChanged}
          onSent={(delivered, intended) => onSent(row, delivered, intended)}
          onDeleted={onDeleted}
        />
      ))}
    </div>
  );
}

function CollectionCard({
  row,
  employees,
  open,
  onToggle,
  onChanged,
  onSent,
  onDeleted,
}: {
  row: CollectionRow;
  employees: Employee[];
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onSent: (delivered: number, intended: number) => void;
  onDeleted: () => void;
}) {
  const status = statusOf(row);
  const subtitle = [moneyLine(row.collection), edgeLine(row.collection)].filter(Boolean).join(" · ");
  const [closing, setClosing] = useState(false);
  /** Отказ рисуется на самой строке — так же, как в мини-аппе: список длинный,
   *  и сообщение над ним для нажавшего внизу невидимо. */
  const [closeError, setCloseError] = useState<string | null>(null);

  async function close() {
    setClosing(true);
    setCloseError(null);
    try {
      await apiClient.setCollectionClosed(row.collection.id, true);
      await onChanged();
    } catch (err) {
      console.error("Close collection failed:", err);
      setCloseError("Не получилось закрыть сбор. Попробуй ещё раз.");
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className={`birthday-card${open ? " open" : ""}`} data-testid="collection-card">
      <div className="birthday-card-head">
        <span className="birthday-name">{cardSubject(row)}</span>
        {subtitle && <span className="birthday-when">{subtitle}</span>}
        <span className={`birthday-status ${status.tone}`}>{status.label}</span>
        {/* «Собрали» прямо в строке: закрыть сбор — самое частое, что с ним
            делают, и раскрывать ради этого карточку незачем. Внутри карточки
            кнопка остаётся — там она про пару «закрыть / открыть заново». */}
        {row.collection.closedAt == null && (
          <button type="button" className="btn btn-primary" disabled={closing} onClick={() => void close()}>
            {closing ? "…" : "Собрали"}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onToggle}>
          {open ? "Свернуть" : "Открыть"}
        </button>
      </div>
      {closeError && <div className="employees-error">{closeError}</div>}

      {open && (
        <CollectionEditor
          row={row}
          employees={employees}
          onChanged={onChanged}
          onSent={onSent}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}

function CollectionEditor({
  row,
  employees,
  onChanged,
  onSent,
  onDeleted,
}: {
  row: CollectionRow;
  employees: Employee[];
  onChanged: () => Promise<void>;
  onSent: (delivered: number, intended: number) => void;
  onDeleted: () => void;
}) {
  const { collection } = row;
  const [title, setTitle] = useState(collection.title ?? "");
  const [employeeId, setEmployeeId] = useState(collection.employeeId ?? 0);
  const [eventDate, setEventDate] = useState(collection.eventDate ?? "");
  const [deadline, setDeadline] = useState(collection.deadline ?? "");
  const [amountPerPerson, setAmountPerPerson] = useState(collection.amountPerPerson?.toString() ?? "");
  const [totalGoal, setTotalGoal] = useState(collection.totalGoal?.toString() ?? "");
  const [collectUrl, setCollectUrl] = useState(collection.collectUrl ?? "");
  const [messageText, setMessageText] = useState(collection.messageText ?? "");
  const [preview, setPreview] = useState<CollectionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** The send button arms itself first; the second press is the one that sends. */
  const [confirming, setConfirming] = useState(false);

  const busy = saving || sending || closing || deleting;
  // Повод и виновника после первой рассылки не меняют — команда уже прочитала,
  // на что скидывается. Сервер это запрещает; поля гасим, чтобы отказ не
  // прилетал уже после того, как всё перепечатали.
  const subjectFrozen = collection.sendCount > 0;
  const isBirthday = collection.kind === "birthday";

  async function loadPreview() {
    try {
      setPreview(await apiClient.getCollectionPreview(collection.id));
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Не удалось собрать предпросмотр");
    }
  }

  useEffect(() => {
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.id]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setConfirming(false);
    try {
      // У раунда дня рождения повода и виновника нет — они заданы датой
      // рождения, и сервер такую правку отвергает.
      const patch: CollectionPatch = {
        eventDate: eventDate || null,
        deadline: deadline || null,
        amountPerPerson: moneyValue(amountPerPerson),
        totalGoal: moneyValue(totalGoal),
        collectUrl: collectUrl.trim() || null,
        messageText: messageText.trim() || null,
      };
      if (!isBirthday && !subjectFrozen) {
        patch.title = title.trim();
        patch.employeeId = employeeId === 0 ? null : employeeId;
      }
      await apiClient.saveCollection(collection.id, patch);
      await loadPreview();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const result = await apiClient.sendCollection(collection.id);
      setConfirming(false);
      onSent(result.delivered, result.intended);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось разослать");
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  async function handleClose(closed: boolean) {
    setClosing(true);
    setError(null);
    try {
      await apiClient.setCollectionClosed(collection.id, closed);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось закрыть сбор");
    } finally {
      setClosing(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await apiClient.deleteCollection(collection.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить сбор");
      setDeleting(false);
    }
  }

  return (
    <div className="birthday-editor">
      {!isBirthday && (
        <>
          <label className="birthday-label">
            Повод
            <input
              type="text"
              aria-label="Повод сбора"
              value={title}
              disabled={busy || subjectFrozen}
              onChange={(e) => { setTitle(e.target.value); setConfirming(false); }}
            />
          </label>
          <PersonPicker
            label="Кому"
            people={employees.filter((e) => e.isActive)}
            value={employeeId}
            onChange={(id) => { setEmployeeId(id); setConfirming(false); }}
            emptyOptionLabel="Общий сбор — на всех"
            disabled={busy || subjectFrozen}
          />
          {subjectFrozen && (
            <div className="birthday-blocker">
              Повод и виновника менять уже нельзя: команда прочитала, на что скидывается.
            </div>
          )}
        </>
      )}

      <CollectionFields
        busy={busy}
        eventDate={eventDate}
        deadline={deadline}
        amountPerPerson={amountPerPerson}
        totalGoal={totalGoal}
        collectUrl={collectUrl}
        messageText={messageText}
        onEventDate={(v) => { setEventDate(v); setConfirming(false); }}
        onDeadline={(v) => { setDeadline(v); setConfirming(false); }}
        onAmountPerPerson={(v) => { setAmountPerPerson(v); setConfirming(false); }}
        onTotalGoal={(v) => { setTotalGoal(v); setConfirming(false); }}
        onCollectUrl={(v) => { setCollectUrl(v); setConfirming(false); }}
        onMessageText={(v) => { setMessageText(v); setConfirming(false); }}
      />

      <div className="journal-controls">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void handleSave()}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => void handleClose(collection.closedAt == null)}
        >
          {collection.closedAt == null ? "Собрали, закрыть" : "Открыть заново"}
        </button>
        {/* Удалить можно только то, о чём никто ещё не слышал: после рассылки
            люди уже получили письмо, и строка журнала про неё должна остаться
            осмысленной. Раунд дня рождения не удаляется вовсе — он выведен из
            даты рождения, и следующий проход завёл бы его заново. */}
        {!isBirthday && collection.sendCount === 0 && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void handleDelete()}>
            {deleting ? "Удаляю…" : "Удалить сбор"}
          </button>
        )}
      </div>

      {error && <div className="employees-error">{error}</div>}

      {preview && (
        <SendBlock
          preview={preview}
          personName={row.personName}
          busy={busy}
          sending={sending}
          confirming={confirming}
          onArm={() => setConfirming(true)}
          onCancel={() => setConfirming(false)}
          onSend={() => void handleSend()}
        />
      )}

      <PaymentsBlock collectionId={collection.id} canRemind={collection.sendCount > 0} />
    </div>
  );
}


/**
 * Кто сдал, а кто нет — поимённо, и дожим по тем, кто ещё нет.
 *
 * Тот же блок, что во вкладке админа в мини-аппе. Счёт приходит с сервера, а
 * не считается здесь: два независимых счёта разъезжаются на третьем месяце,
 * чему в этом репозитории уже есть примеры.
 *
 * Грузится при раскрытии карточки, а не вместе со списком: сборов бывает
 * десяток, а раскрыт один.
 */
function PaymentsBlock({ collectionId, canRemind }: { collectionId: number; canRemind: boolean }) {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [paidCount, setPaidCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiClient
      .getCollectionPayments(collectionId)
      .then((loaded) => {
        if (!alive) return;
        setRows(loaded.rows);
        setPaidCount(loaded.paidCount);
        setTotal(loaded.total);
      })
      .catch(() => { if (alive) setError("Не удалось загрузить отметки"); });
    return () => { alive = false; };
  }, [collectionId]);

  const unpaidCount = total - paidCount;

  function toggle(row: PaymentRow) {
    if (busy) return;
    setBusy(true);
    setError(null);
    apiClient
      .setCollectionPaymentFor(collectionId, row.employeeId, !row.paid)
      .then((loaded) => {
        setRows(loaded.rows);
        setPaidCount(loaded.paidCount);
        setTotal(loaded.total);
      })
      // Пока сервер не подтвердил, экран не перекрашивается: галочка — это
      // утверждение о деньгах, и показать её, не записав, значит соврать.
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось отметить"))
      .finally(() => setBusy(false));
  }

  function remind() {
    setBusy(true);
    setError(null);
    apiClient
      .remindUnpaid(collectionId)
      .then((result) => {
        setConfirming(false);
        setNotice(`Напомнил: дошло до ${result.delivered} из ${result.intended}.`);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Не удалось напомнить"))
      .finally(() => setBusy(false));
  }

  return (
    <>
      <div className="birthday-preview-title">
        Отметились {paidCount} из {total}
      </div>
      <div className="birthday-recipients">
        {rows.map((row) => (
          <button
            key={row.employeeId}
            type="button"
            className="btn btn-secondary"
            data-testid={`payment-toggle-${row.employeeId}`}
            disabled={busy}
            onClick={() => toggle(row)}
          >
            {row.paid ? "✓ " : "· "}
            {row.displayName}
            {/* «Я отметился» и «за меня отметили» — разные утверждения, и на
                экране это должно быть видно. */}
            {row.markedByAdmin ? " (отметил админ)" : ""}
          </button>
        ))}
      </div>

      {confirming ? (
        <div className="birthday-confirm">
          <span>
            Напомнить {unpaidCount === 1 ? "одному человеку" : `${unpaidCount} коллегам`}? Сообщения уйдут сразу.
          </span>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={remind}>
            Да, напомнить
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <div className="journal-controls">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy || unpaidCount === 0 || !canRemind}
            onClick={() => setConfirming(true)}
          >
            Напомнить не сдавшим ({unpaidCount})
          </button>
        </div>
      )}
      {!canRemind && <div className="birthday-blocker">Сбор ещё не рассылали — дожимать нечего.</div>}
      {notice && <div className="birthday-preview-title">{notice}</div>}
      {error && <div className="employees-error">{error}</div>}
    </>
  );
}

/**
 * Предпросмотр и отправка — общий блок для сбора и для раунда дня рождения.
 *
 * Один на оба: текст, поимённый список и взводимая кнопка — ровно то, что он
 * утвердил как единственный способ написать команде.
 */
function SendBlock({
  preview,
  personName,
  busy,
  sending,
  confirming,
  onArm,
  onCancel,
  onSend,
}: {
  preview: CollectionPreview;
  personName: string | null;
  busy: boolean;
  sending: boolean;
  confirming: boolean;
  onArm: () => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <>
      <div className="birthday-preview-title">Уйдёт вот это:</div>
      <pre className="birthday-message">{preview.message}</pre>

      <div className="birthday-preview-title">
        Получат {recipientsSubject(preview.recipients.length)}
        {personName ? ` — все, кроме ${personName}:` : " — вся команда:"}
      </div>
      <div className="birthday-recipients">
        {preview.recipients.length === 0 ? (
          <span className="employees-empty">Некому: ни у кого не привязан Telegram.</span>
        ) : (
          preview.recipients.map((person) => (
            <span className="birthday-recipient" key={person.employeeId}>
              {person.displayName}
            </span>
          ))
        )}
      </div>

      {confirming ? (
        <div className="birthday-confirm">
          <span>
            Отправить {recipientsPhrase(preview.recipients.length)}? Отменить будет нельзя — сообщения уйдут сразу.
          </span>
          <button type="button" className="btn btn-primary" disabled={sending} onClick={onSend}>
            {sending ? "Отправляю…" : "Да, разослать"}
          </button>
          <button type="button" className="btn btn-secondary" disabled={sending} onClick={onCancel}>
            Отмена
          </button>
        </div>
      ) : (
        <>
          {/* Кнопка остаётся на месте и погашенной, а причина стоит подписью под
              ней. Прежде непустой блокер её ЗАМЕНЯЛ абзацем текста — владелец
              создал сбор и не нашёл, чем его разослать: человек ищет кнопку, а
              на её месте читается описание, а не «вот чего не хватает». */}
          <div className="journal-controls">
            <button type="button" className="btn btn-primary" disabled={busy || preview.blocker != null} onClick={onArm}>
              {sendButtonLabel(preview)}
            </button>
          </div>
          {preview.blocker ? <div className="birthday-blocker">{preview.blocker}</div> : null}
        </>
      )}
    </>
  );
}

interface RowProps {
  birthday: UpcomingBirthday;
  today: string;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onSent: (delivered: number, intended: number) => void;
}

function BirthdayRow({ birthday, today, open, onToggle, onChanged, onSent }: RowProps) {
  const palette = personPalette(birthday.employeeId);
  const status = roundStatus(birthday.campaign, today);

  return (
    <div className={`birthday-card${open ? " open" : ""}`}>
      <div className="birthday-card-head">
        <span className="avatar avatar-sm" style={{ background: palette.bg, color: palette.fg }}>
          {initialsOf(birthday.displayName)}
        </span>
        <span className="birthday-name">{birthday.displayName}</span>
        <span className="birthday-when">{whenLabel(birthday)}</span>
        <span className={`birthday-status ${status.tone}`}>{status.label}</span>
        <button type="button" className="btn btn-secondary" onClick={onToggle}>
          {open ? "Свернуть" : status.tone === "sent" ? "Посмотреть" : "Подготовить сбор"}
        </button>
      </div>

      {open && <BirthdayEditor birthday={birthday} onChanged={onChanged} onSent={onSent} />}
    </div>
  );
}

/**
 * Раунд дня рождения: адресуется работником, а не идентификатором сбора —
 * раунда может ещё не быть, он заводится первым сохранением, и до него у
 * предпросмотра `id: 0`.
 */
function BirthdayEditor({ birthday, onChanged, onSent }: Omit<RowProps, "open" | "onToggle" | "today">) {
  const [collectUrl, setCollectUrl] = useState(birthday.campaign?.collectUrl ?? "");
  const [messageText, setMessageText] = useState(birthday.campaign?.messageText ?? "");
  const [preview, setPreview] = useState<CollectionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  /** The send button arms itself first; the second press is the one that sends. */
  const [confirming, setConfirming] = useState(false);

  async function loadPreview() {
    try {
      setPreview(await apiClient.getBirthdayPreview(birthday.employeeId));
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Не удалось собрать предпросмотр");
    }
  }

  useEffect(() => {
    void loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birthday.employeeId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setConfirming(false);
    try {
      await apiClient.saveBirthdayRound(birthday.employeeId, {
        collectUrl: collectUrl.trim() || null,
        messageText: messageText.trim() || null,
      });
      await loadPreview();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (!preview) return;
    setSending(true);
    setError(null);
    try {
      const result = await apiClient.sendCollection(preview.id);
      setConfirming(false);
      onSent(result.delivered, result.intended);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось разослать");
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  const sent = (birthday.campaign?.sendCount ?? 0) > 0;
  const busy = saving || sending;

  return (
    <div className="birthday-editor">
      {sent ? (
        <div className="birthday-sent-note">
          Уже разослано{birthday.campaign?.sentCount ? ` — ${recipientsPhrase(birthday.campaign.sentCount)}` : ""}.
          Повторная отправка отключена, чтобы никто не получил поздравление дважды.
        </div>
      ) : (
        <>
          <label className="birthday-label">
            Ссылка на сбор (Сбербанк Онлайн)
            <input
              type="url"
              placeholder="https://..."
              value={collectUrl}
              disabled={busy}
              onChange={(e) => {
                setCollectUrl(e.target.value);
                setConfirming(false);
              }}
            />
          </label>

          {/* The placeholder is a hint, not the default text: the default is shown
              in full right below, and printing it twice just made it look editable. */}
          <label className="birthday-label">
            Свой текст — необязательно
            <textarea
              rows={4}
              placeholder="Оставь пустым — уйдёт текст ниже"
              value={messageText}
              disabled={busy}
              onChange={(e) => {
                setMessageText(e.target.value);
                setConfirming(false);
              }}
            />
          </label>

          <div className="journal-controls">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void handleSave()}>
              {saving ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </>
      )}

      {error && <div className="employees-error">{error}</div>}

      {preview && (
        preview.id === 0 ? (
          // Раунда ещё нет: предпросмотр — черновик, рассылать пока нечего.
          // Первое «Сохранить» его и заводит.
          <>
            <div className="birthday-preview-title">Уйдёт вот это:</div>
            <pre className="birthday-message">{preview.message}</pre>
            <div className="birthday-blocker">Сохрани — и появится кнопка рассылки.</div>
          </>
        ) : (
          <SendBlock
            preview={preview}
            personName={birthday.displayName}
            busy={busy}
            sending={sending}
            confirming={confirming}
            onArm={() => setConfirming(true)}
            onCancel={() => setConfirming(false)}
            onSend={() => void handleSend()}
          />
        )
      )}

      {/* Отметки и у раунда ДР: на подарок скидываются так же, а виновник в
          получатели не входит никогда — сюрприз дожимом не выдаётся. */}
      {birthday.campaign && (
        <PaymentsBlock collectionId={birthday.campaign.id} canRemind={birthday.campaign.sendCount > 0} />
      )}
    </div>
  );
}
