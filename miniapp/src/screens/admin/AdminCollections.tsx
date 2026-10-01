import { useEffect, useState } from "react";
import {
  autoSendLabel,
  collectionStatus,
  describeDaysUntil,
  formatDayMonth,
  formatMoney,
  isCollectionActive,
} from "@planer/shared";
import { Cell, Input, Placeholder, Spinner, Switch, Textarea } from "@telegram-apps/telegram-ui";
import { PersonPicker } from "../../components/PersonPicker";
import { RecipientGroupField } from "../../components/RecipientGroupField";
import {
  apiClient,
  type Collection,
  type CollectionPatch,
  type CollectionPreview,
  type CollectionRow,
  type Employee,
  type PaymentRow,
  type UpcomingBirthday,
} from "../../api/client";
import { CollapsibleArchive } from "../../components/CollapsibleArchive";
import { initialsOf, personPalette } from "../../lib/people";
import { withNotifyNotice } from "../../lib/shift";
import { ActionButton, Card, Group, Hint, StatusPill } from "../../ui";

/**
 * «Сборы» (admin, mobile): деньги, которые команда скидывает — на день
 * рождения или по любому другому поводу.
 *
 * Правило, вокруг которого экран строился, — «бот никогда не пишет команде
 * сам» — с 31.08.2026 отменено для одного случая: сбор на день рождения со
 * ссылкой уходит команде сам за три дня до праздника. Предохранителем вместо
 * нажатой кнопки стала видимость, и стоит она здесь: строка «Бот разошлёт
 * команде …» с тумблером на карточке, которым любой админ останавливает
 * рассылку одним тапом.
 *
 * Всё остальное по-прежнему руками: вставить ссылку, поправить текст,
 * прочитать точный текст и точный поимённый список — и только потом отправить.
 * Кнопка отправки сначала взводится: на телефоне единственное действие,
 * которое пишет сразу всем, не должно быть в одном случайном тапе. Кастомный
 * сбор (свадьба, проводы) исключения не получил — у него нет даты, от которой
 * считать «за три дня».
 *
 * Второе правило — **сюрприз**: сбор, где ты виновник, сервер тебе не отдаёт
 * вообще. Поэтому экран его и не прячет — прятать уже нечего.
 *
 * Тот же поток, что в консольном `CollectionsScreen`, собранный в одну колонку.
 */

export type StatusTone = "sent" | "ready" | "pending";

/**
 * Где сбор, в одном слове.
 *
 * Закрытый читается закрытым, а не «Разослано»: после закрытия в нём уже
 * ничего не происходит, и пилюля про рассылку выглядела бы как приглашение
 * дожать.
 */
export function statusOf(row: Pick<CollectionRow, "collection" | "status" | "active">): { label: string; tone: StatusTone } {
  // Короче консольных формулировок намеренно: на 390 пилюля делит строку с
  // поводом и датой, и «Готово к отправке» роняло вторую строку.
  if (!row.active) return { label: "Закрыт", tone: "pending" };
  if (row.status === "sent") return { label: `Разослано · ${row.collection.sentCount}`, tone: "sent" };
  if (row.status === "ready") return { label: "Готово", tone: "ready" };
  return { label: "Нет ссылки", tone: "pending" };
}

/**
 * Та же пилюля для раунда дня рождения из списка ближайших.
 *
 * У списка ближайших нет посчитанной сервером строки — там лежит сама запись
 * (или ничего, пока раунд не сохранён ни разу). Статус и активность считаются
 * теми же функциями `@planer/shared`, что и на сервере, чтобы два списка на
 * одном экране не разошлись в словах про один и тот же раунд.
 */
export function roundStatus(campaign: Collection | null, today: string): { label: string; tone: StatusTone } {
  if (!campaign) return { label: "Нет ссылки", tone: "pending" };
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

/** "1 коллеге" / "5 коллегам" — the dative the send button is written in. */
export function recipientsPhrase(count: number): string {
  return `${count} ${count === 1 ? "коллеге" : "коллегам"}`;
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
 * Дожим обязан говорить, что рассылка уже была, и когда: иначе второй тап
 * выглядит как первый, и админ шлёт команде третье письмо, думая, что первое
 * не ушло.
 */
export function sendButtonLabel(preview: CollectionPreview): string {
  if (preview.sendCount === 0) return `Разослать ${recipientsPhrase(preview.recipients.length)}`;
  const when = preview.lastSentAt ? ` · рассылалось ${formatDayMonth(preview.lastSentAt.slice(0, 10))}` : "";
  return `Напомнить ещё раз${when}`;
}

/**
 * Тон пилюли по статусу: «Готово» ждёт кнопки админа (`need`), «Разослано» —
 * улажено (`ok`), а «Нет ссылки» и «Закрыт» ждут чего-то ещё или уже ничего не
 * ждут (`wait`). Слова статуса остаются за `statusOf`: тон — только вид.
 */
const TONE_PILL: Record<StatusTone, "need" | "wait" | "ok"> = {
  sent: "ok",
  ready: "need",
  pending: "wait",
};

const ERROR_STYLE = { color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" } as const;
const MESSAGE_BOX_STYLE = {
  padding: "10px 12px",
  borderRadius: "var(--app-radius-control)",
  background: "var(--tgui--secondary_bg_color)",
  fontSize: "var(--app-text-meta)",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
} as const;
const FIELD_LABEL_STYLE = { fontSize: "var(--app-text-meta)", fontWeight: 600, color: "var(--tgui--hint_color)" } as const;

const DATE_INPUT_STYLE = {
  padding: "8px 10px",
  minHeight: "var(--app-tap)",
  borderRadius: "var(--app-radius-control)",
  border: "1px solid var(--tgui--outline)",
  background: "var(--tgui--secondary_bg_color)",
  color: "var(--tgui--text_color)",
  font: "inherit",
  fontSize: "var(--app-text-body)",
  // Нативное поле даты имеет собственную минимальную ширину и в узкой колонке
  // выпирало за край: на 320px форма получала горизонтальную прокрутку страницы.
  minWidth: 0,
  width: "100%",
  boxSizing: "border-box",
} as const;

export function AdminCollections({
  /** Командная дата из bootstrap (`data.today`), а не часы телефона: баг из
   *  ledger — админ в другом часовом поясе видел статусы карточек и минимум
   *  даты напоминания посчитанными по своим часам, а не по команде. */
  today,
}: {
  today: string;
}) {
  const [birthdays, setBirthdays] = useState<UpcomingBirthday[] | null>(null);
  const [rows, setRows] = useState<CollectionRow[] | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  /** Кто смотрит: из «Кому» его надо вычесть — см. `NewCollectionForm`. */
  const [viewerId, setViewerId] = useState<number | null>(null);
  const [openBirthday, setOpenBirthday] = useState<number | null>(null);
  const [openCollection, setOpenCollection] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reloadBirthdays() {
    try {
      setBirthdays(await apiClient.getBirthdays());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить дни рождения");
    }
  }

  async function reloadCollections() {
    try {
      setRows(await apiClient.getCollections());
    } catch (err) {
      setRowsError(err instanceof Error ? err.message : "Не удалось загрузить сборы");
    }
  }

  // Два списка пересекаются — один и тот же раунд читался бы «Готово» в одном
  // и «Разослано» в другом сразу после отправки, если перечитывать только один.
  // Поэтому каждая правка ниже перечитывает оба, вместе.
  async function reloadEverything() {
    await Promise.all([reloadBirthdays(), reloadCollections()]);
  }

  useEffect(() => {
    void reloadEverything();
    void (async () => {
      try {
        const [me, list] = await Promise.all([apiClient.getMe(), apiClient.getAdminEmployees()]);
        setViewerId(me.id);
        setEmployees(list);
      } catch {
        // Форма нового сбора обойдётся без «Кому» — общий сбор завести можно и
        // так. Своей строкой ошибки здесь нет намеренно: списки выше грузятся
        // отдельно, и их беда важнее.
      }
    })();
    // Грузится один раз; каждая правка ниже перечитывает списки явно.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!birthdays) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
        <Spinner size="m" />
      </div>
    );
  }

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

  // Корня-экрана здесь нет: заголовок «Сборы», поля и резерв под таб-бар даёт
  // `Screen` во вкладке (`CollectionsTabScreen`), а блоки идут прямо друг за другом.
  return (
    <>
      {/* Сообщения о том, что только что произошло, — над всеми списками:
          они одинаково относятся и к сбору, и к дню рождения, а внутри
          секции ДР оказывались ниже сбора, о котором рассказывают. */}
      {error && (
        <Card>
          <div style={ERROR_STYLE}>{error}</div>
        </Card>
      )}
      {notice && (
        <Card>
          <div style={{ fontSize: "var(--app-text-meta)" }}>{notice}</div>
        </Card>
      )}

      {/* Идущие сборы — первым делом. Экран открывают, чтобы посмотреть на
          них или разослать дожим, а календарь дней рождения на год вперёд —
          справка, за которой сюда не ходят. Порядок тот же, что в консоли:
          один экран на двух фронтах не должен читаться по-разному. */}
      <Group header="Идут сборы">
        <CollectionsList
          rows={openRows}
          error={rowsError}
          // Не «сборов пока не было», когда они были и все закрыты: список
          // ниже прямо противоречил бы этой фразе.
          emptyLabel={closedRows.length > 0 ? "Открытых сборов нет — закрытые ниже." : "Сборов пока не было."}
          employees={employees}
          viewerId={viewerId}
          openId={openCollection}
          onToggle={toggleCollection}
          onChanged={reloadEverything}
          onSent={handleSent}
          onDeleted={handleDeleted}
        />
      </Group>

      <Group header="Новый сбор">
        <NewCollectionForm
          employees={employees}
          viewerId={viewerId}
          onCreated={async () => {
            setNotice(null);
            await reloadEverything();
          }}
        />
      </Group>

      <Group header="Ближайшие дни рождения">
        <Hint>
          За неделю до дня рождения бот напишет админам. Пришли ему ссылку на сбор — он привяжет её сам
          и за три дня разошлёт команде, кроме именинника. Не хочешь автоматом — выключи тумблер на карточке
          или нажми «Разослать» раньше.
        </Hint>

        {birthdays.length === 0 && (
          <Placeholder description="Ни у кого не указан день рождения — проставь даты в разделе «Работники»." />
        )}

        {birthdays.map((birthday) => (
          <BirthdayCard
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
        ))}
      </Group>

      {/* Закрытые не мешают живым, но и не пропадают: их ещё открывают заново. */}
      <CollapsibleArchive title="Закрытые" items={closedRows}>
        {(closed) => (
          <CollectionsList
            rows={closed as CollectionRow[]}
            // Ошибка загрузки уже показана в секции выше — второй раз тем же текстом незачем.
            error={null}
            emptyLabel="Сборов пока не было."
            employees={employees}
            viewerId={viewerId}
            openId={openCollection}
            onToggle={toggleCollection}
            onChanged={reloadEverything}
            onSent={handleSent}
            onDeleted={handleDeleted}
          />
        )}
      </CollapsibleArchive>
    </>
  );
}

/**
 * «+ Новый сбор» — свёрнутая форма, разворачивается по тапу.
 *
 * Свёрнута по умолчанию, потому что раздел открывают чаще ради чужого сбора,
 * чем ради нового: восемь полей сверху отодвинули бы списки за край экрана.
 */
function NewCollectionForm({
  employees,
  viewerId,
  onCreated,
}: {
  employees: Employee[];
  viewerId: number | null;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [employeeId, setEmployeeId] = useState(0);
  const [eventDate, setEventDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [amountPerPerson, setAmountPerPerson] = useState("");
  const [totalGoal, setTotalGoal] = useState("");
  const [collectUrl, setCollectUrl] = useState("");
  const [messageText, setMessageText] = useState("");
  const [recipientGroupId, setRecipientGroupId] = useState<number | null>(null);
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
    setRecipientGroupId(null);
    setError(null);
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.createCollection({
        title: title.trim(),
        employeeId: employeeId === 0 ? null : employeeId,
        eventDate: eventDate || null,
        deadline: deadline || null,
        amountPerPerson: moneyValue(amountPerPerson),
        totalGoal: moneyValue(totalGoal),
        collectUrl: collectUrl.trim() || null,
        messageText: messageText.trim() || null,
        recipientGroupId,
      });
      reset();
      setOpen(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать сбор");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Card>
        <ActionButton compact stretched onClick={() => setOpen(true)}>
          + Новый сбор
        </ActionButton>
      </Card>
    );
  }

  return (
    <Card>
      <Input
        header="Повод"
        placeholder="Например, Свадьба"
        value={title}
        disabled={busy}
        onChange={(e) => setTitle(e.target.value)}
      />
      {/* Виновника можно не выбирать — это и есть общий сбор. Себя в списке
          нет: сбор, где ты виновник, сервер тебе потом не отдаст, и созданная
          строка тут же пропала бы с экрана — вместе с возможностью её
          разослать или удалить. */}
      <PersonPicker
        label="Кому"
        people={employees.filter((e) => e.isActive && e.id !== viewerId)}
        value={employeeId}
        onChange={setEmployeeId}
        emptyOptionLabel="Общий сбор — на всех"
        disabled={busy}
      />
      <RecipientGroupField value={recipientGroupId} onChange={setRecipientGroupId} sent={false} disabled={busy} />

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

      {error && <div style={ERROR_STYLE}>{error}</div>}

      {/* Единственная primary формы. */}
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton
          kind="primary"
          compact
          stretched
          loading={busy}
          disabled={!canCreate(title) || busy}
          onClick={() => void handleCreate()}
        >
          Создать
        </ActionButton>
        <ActionButton compact disabled={busy} onClick={() => { reset(); setOpen(false); }}>
          Отмена
        </ActionButton>
      </div>
    </Card>
  );
}

/** Пустое поле — это «не задано», а не ноль: сервер знает разницу. */
function moneyValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * Шесть полей, одинаковых в форме создания и в редакторе.
 *
 * Вынесены в один компонент, чтобы созданный сбор и открытый на правку не
 * начали спрашивать разное — этот класс расхождения в репозитории уже ловили
 * на подписях категорий и на палитре.
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
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={FIELD_LABEL_STYLE}>Дата события</span>
          <input
            type="date"
            value={eventDate}
            disabled={busy}
            aria-label="Дата события"
            style={DATE_INPUT_STYLE}
            onChange={(e) => onEventDate(e.target.value)}
          />
        </label>
        <label style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={FIELD_LABEL_STYLE}>Скинуться до</span>
          <input
            type="date"
            value={deadline}
            disabled={busy}
            aria-label="Скинуться до"
            style={DATE_INPUT_STYLE}
            onChange={(e) => onDeadline(e.target.value)}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Input
            header="По сколько"
            type="number"
            inputMode="numeric"
            placeholder="₽"
            value={amountPerPerson}
            disabled={busy}
            onChange={(e) => onAmountPerPerson(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Input
            header="Нужно всего"
            type="number"
            inputMode="numeric"
            placeholder="₽"
            value={totalGoal}
            disabled={busy}
            onChange={(e) => onTotalGoal(e.target.value)}
          />
        </div>
      </div>

      {/* Заголовки короткие: на телефоне `Input` режет свой лейбл многоточием,
          и «Ссылка на сбор (Сбербан…» не говорит ничего сверх самого поля. */}
      <Input
        header="Ссылка на сбор"
        type="url"
        inputMode="url"
        placeholder="https://..."
        value={collectUrl}
        disabled={busy}
        onChange={(e) => onCollectUrl(e.target.value)}
      />
      <Textarea
        header="Свой текст"
        rows={3}
        placeholder="Оставь пустым — уйдёт текст ниже"
        value={messageText}
        disabled={busy}
        onChange={(e) => onMessageText(e.target.value)}
      />
    </>
  );
}

/**
 * Все сборы — и закрытые тоже.
 *
 * Читается своим запросом, а не фильтруется из списка выше: тот ключуется
 * ближайшим днём рождения, и сбор выпадает из него на следующий день после
 * праздника — ровно тот сбор, на который потом хотят посмотреть.
 *
 * Порядок задан сервером (`compareCollections` из `@planer/shared`), тем же,
 * что и в консоли: два независимых `sort` — это два разных списка через
 * полгода.
 */
function CollectionsList({
  rows,
  error,
  emptyLabel,
  employees,
  viewerId,
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
  viewerId: number | null;
  openId: number | null;
  onToggle: (id: number) => void;
  onChanged: () => Promise<void>;
  onSent: (row: CollectionRow, delivered: number, intended: number) => void;
  onDeleted: () => void;
}) {
  if (error) return <Card><div style={ERROR_STYLE}>{error}</div></Card>;
  if (!rows) return <Card><Spinner size="s" /></Card>;
  if (rows.length === 0) return <Card><Hint>{emptyLabel}</Hint></Card>;

  return (
    <>
      {rows.map((row) => (
        <CollectionCard
          key={row.collection.id}
          row={row}
          employees={employees}
          viewerId={viewerId}
          open={openId === row.collection.id}
          onToggle={() => onToggle(row.collection.id)}
          onChanged={onChanged}
          onSent={(delivered, intended) => onSent(row, delivered, intended)}
          onDeleted={onDeleted}
        />
      ))}
    </>
  );
}

/**
 * Подпись сверху карточки раскрытого сбора: чей он.
 *
 * Раскрытый сбор — несколько соседних карточек (форма, рассылка, отметки,
 * закрытие) на том же расстоянии друг от друга, что и карточка следующего
 * сбора. Кнопка, которая пишет всей команде или удаляет, без названия не
 * говорит, к какому сбору относится, — и прокрутившему вниз остаётся гадать.
 */
function OwnerLine({ children }: { children: string }) {
  return <p className="ui-hint ui-item__owner">{children}</p>;
}

/** Дедлайн главнее даты события — как в правиле активности. */
function edgeLine(c: Collection): string | null {
  if (c.deadline) return `до ${formatDayMonth(c.deadline)}`;
  if (c.eventDate) return formatDayMonth(c.eventDate);
  if (c.celebratedOn) return formatDayMonth(c.celebratedOn);
  return null;
}

function CollectionCard({
  row,
  employees,
  viewerId,
  open,
  onToggle,
  onChanged,
  onSent,
  onDeleted,
}: {
  row: CollectionRow;
  employees: Employee[];
  viewerId: number | null;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onSent: (delivered: number, intended: number) => void;
  onDeleted: () => void;
}) {
  const status = statusOf(row);
  const subtitle = [moneyLine(row.collection), edgeLine(row.collection)].filter(Boolean).join(" · ");
  const [closing, setClosing] = useState(false);
  /** Отказ рисуется на самой строке: экран — один длинный скролл, и сообщение
   *  над списком для нажавшего в нижней карточке невидимо. */
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

  // Открытый сбор — несколько карточек подряд, а не одна длинная: в одной
  // карточке «Собрали», «Сохранить» и «Да, разослать» были бы тремя главными
  // кнопками, а правило — одна на карточку. Строка сбора остаётся первой.
  return (
    <div className={open ? "ui-item ui-item--open" : "ui-item"}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "var(--app-text-body)", overflowWrap: "anywhere" }}>{cardSubject(row)}</div>
            {subtitle && <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>{subtitle}</div>}
          </div>
          <span style={{ flex: "none" }}>
            <StatusPill tone={TONE_PILL[status.tone]}>{status.label}</StatusPill>
          </span>
        </div>

        {row.collection.collectUrl && <CopyableLink url={row.collection.collectUrl} />}

        {/* Равные доли: `stretched` у `ActionButton` — `flex: 1 1 0`, и «Собрали»
            не ужимается до «Соб…», как ужималось при одной растянутой кнопке. */}
        <div style={{ display: "flex", gap: 8 }}>
          <ActionButton compact stretched aria-expanded={open} onClick={onToggle}>
            {open ? "Свернуть" : "Открыть"}
          </ActionButton>
          {/* «Собрали» прямо в строке: закрыть сбор — самое частое, что с ним
              делают, и ради одного нажатия карточку раскрывать незачем. Внутри
              раскрытого сбора кнопка остаётся — там она про пару «закрыть /
              открыть заново». Закрытый сбор её здесь не показывает: открывать
              заново — редкое действие, и место в строке оно не заслуживает.
              Единственная primary этой карточки. */}
          {row.collection.closedAt == null && (
            <ActionButton
              kind="primary"
              compact
              stretched
              loading={closing}
              disabled={closing}
              onClick={() => void close()}
            >
              Собрали
            </ActionButton>
          )}
        </div>
        {closeError && <div style={ERROR_STYLE}>{closeError}</div>}
      </Card>

      {open && (
        <CollectionEditor
          row={row}
          employees={employees}
          viewerId={viewerId}
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
  viewerId,
  onChanged,
  onSent,
  onDeleted,
}: {
  row: CollectionRow;
  employees: Employee[];
  viewerId: number | null;
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
  const [recipientGroupId, setRecipientGroupId] = useState<number | null>(collection.recipientGroupId);
  const [preview, setPreview] = useState<CollectionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** Кнопка отправки сначала взводится; отправляет второй тап. */
  const [confirming, setConfirming] = useState(false);

  const busy = saving || sending || closing || deleting;
  // Повод и виновника после первой рассылки не меняют — команда уже прочитала,
  // на что скидывается. Сервер это запрещает; поля гасим, чтобы отказ не
  // прилетал уже после того, как человек всё перепечатал.
  const subjectFrozen = collection.sendCount > 0;
  const isBirthday = collection.kind === "birthday";

  async function loadPreview() {
    try {
      setPreview(await apiClient.getCollectionPreview(collection.id));
    } catch (err) {
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
        recipientGroupId,
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

  // Каждый блок — своя карточка, чтобы в каждой была не больше одной главной
  // кнопки: «Сохранить» у формы, «Да, разослать» у рассылки, «Да, напомнить» у
  // дожима. «Сохранить» — всегда главная кнопка своей карточки: взведённая
  // рассылка живёт в другой карточке, и две главные на одной не встречаются.
  return (
    <>
      <Card>
        {!isBirthday && (
          <>
            <Input
              header="Повод"
              value={title}
              disabled={busy || subjectFrozen}
              onChange={(e) => { setTitle(e.target.value); setConfirming(false); }}
            />
            <PersonPicker
              label="Кому"
              people={employees.filter((e) => e.isActive && e.id !== viewerId)}
              value={employeeId}
              onChange={(id) => { setEmployeeId(id); setConfirming(false); }}
              emptyOptionLabel="Общий сбор — на всех"
              disabled={busy || subjectFrozen}
            />
            {subjectFrozen && (
              <Hint>Повод и виновника менять уже нельзя: команда прочитала, на что скидывается.</Hint>
            )}
          </>
        )}

        <RecipientGroupField
          value={recipientGroupId}
          onChange={(id) => { setRecipientGroupId(id); setConfirming(false); }}
          sent={collection.sendCount > 0}
          knownName={preview?.recipientGroupName}
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
          onEventDate={(v) => { setEventDate(v); setConfirming(false); }}
          onDeadline={(v) => { setDeadline(v); setConfirming(false); }}
          onAmountPerPerson={(v) => { setAmountPerPerson(v); setConfirming(false); }}
          onTotalGoal={(v) => { setTotalGoal(v); setConfirming(false); }}
          onCollectUrl={(v) => { setCollectUrl(v); setConfirming(false); }}
          onMessageText={(v) => { setMessageText(v); setConfirming(false); }}
        />

        <ActionButton kind="primary" compact stretched loading={saving} disabled={busy} onClick={() => void handleSave()}>
          Сохранить
        </ActionButton>

        {error && <div style={ERROR_STYLE}>{error}</div>}
      </Card>

      {preview && (
        <Card>
          <OwnerLine>{cardSubject(row)}</OwnerLine>
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
        </Card>
      )}

      <PaymentsBlock collectionId={collection.id} canRemind={collection.sendCount > 0} subject={cardSubject(row)} />

      <Card>
        <OwnerLine>{cardSubject(row)}</OwnerLine>
        <ActionButton
          compact
          stretched
          loading={closing}
          disabled={busy}
          onClick={() => void handleClose(collection.closedAt == null)}
        >
          {collection.closedAt == null ? "Собрали, закрыть" : "Открыть заново"}
        </ActionButton>

        {/* Удалить можно только то, о чём никто ещё не слышал: после рассылки
            люди уже получили письмо, и строка журнала про неё должна остаться
            осмысленной. Раунд дня рождения не удаляется вовсе — он выведен из
            даты рождения, и следующий проход завёл бы его заново. */}
        {!isBirthday && collection.sendCount === 0 && (
          <ActionButton
            kind="quiet"
            danger
            compact
            stretched
            loading={deleting}
            disabled={busy}
            onClick={() => void handleDelete()}
          >
            Удалить сбор
          </ActionButton>
        )}
      </Card>
    </>
  );
}


/**
 * Кто сдал, а кто нет — поимённо, и кнопка дожима по тем, кто ещё нет.
 *
 * Поимённый список живёт только здесь: команде во вкладке «Команда» видна одна
 * цифра. У человека может просто не быть денег до зарплаты, и превращать это в
 * общее знание — не та цена, которую платят за подарок коллеге.
 *
 * Грузится при раскрытии карточки, а не вместе со списком: сборов бывает
 * десяток, а раскрыт один.
 */
function PaymentsBlock({ collectionId, canRemind, subject }: { collectionId: number; canRemind: boolean; subject: string }) {
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
      // Экран не перекрашивается, пока сервер не подтвердил: галочка — это
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
    <Card>
      <OwnerLine>{subject}</OwnerLine>
      <div style={FIELD_LABEL_STYLE}>
        Отметились {paidCount} из {total}
      </div>
      {/* Строки остаются нажимаемыми `button`, а не галочками: это не форма, а
          отметка «за человека», и тап по строке — то же действие, что было. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((row) => (
          <button
            key={row.employeeId}
            type="button"
            data-testid={`payment-toggle-${row.employeeId}`}
            disabled={busy}
            onClick={() => toggle(row)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
              minHeight: "var(--app-tap)", borderRadius: "var(--app-radius-control)", border: "none",
              background: "var(--tgui--secondary_bg_color)", font: "inherit",
              fontSize: "var(--app-text-body)", textAlign: "left", color: "var(--tgui--text_color)", cursor: "pointer",
            }}
          >
            <span style={{ width: 16 }}>{row.paid ? "✓" : "·"}</span>
            <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{row.displayName}</span>
            {/* «Я отметился» и «за меня отметили» — разные утверждения, и на
                экране это должно быть видно. */}
            {row.markedByAdmin && (
              <span style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>отметил админ</span>
            )}
          </button>
        ))}
      </div>

      {confirming ? (
        <>
          <div style={{ fontSize: "var(--app-text-meta)", lineHeight: 1.45 }}>
            Напомнить {unpaidCount === 1 ? "одному человеку" : `${unpaidCount} коллегам`}? Сообщения уйдут сразу.
          </div>
          <ActionButton kind="primary" compact stretched loading={busy} disabled={busy} onClick={remind}>
            Да, напомнить
          </ActionButton>
          <ActionButton compact stretched disabled={busy} onClick={() => setConfirming(false)}>
            Отмена
          </ActionButton>
        </>
      ) : (
        <ActionButton
          compact
          stretched
          disabled={busy || unpaidCount === 0 || !canRemind}
          onClick={() => setConfirming(true)}
        >
          Напомнить не сдавшим ({unpaidCount})
        </ActionButton>
      )}
      {!canRemind && <Hint>Сбор ещё не рассылали — дожимать нечего.</Hint>}
      {notice && <div style={{ fontSize: "var(--app-text-meta)", lineHeight: 1.45 }}>{notice}</div>}
      {error && <div style={ERROR_STYLE}>{error}</div>}
    </Card>
  );
}

/**
 * Предпросмотр и отправка — общий блок для сбора и для раунда дня рождения.
 *
 * Один на оба: текст, поимённый список и взводимая кнопка — это ровно то, что
 * он утвердил как единственный способ написать команде, и разъехаться двум
 * копиям здесь было бы дороже всего.
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
      <div style={FIELD_LABEL_STYLE}>Уйдёт вот это:</div>
      {/* Показано так, как придёт — те же переносы, и длинная ссылка переносится,
          а не выталкивает карточку за край экрана. */}
      <div style={MESSAGE_BOX_STYLE}>{preview.message}</div>

      <div style={FIELD_LABEL_STYLE}>
        Получат {recipientsSubject(preview.recipients.length)}
        {preview.recipientGroupName
          ? ` — группа «${preview.recipientGroupName}»${personName ? `, кроме ${personName}` : ""}:`
          : personName
            ? ` — все, кроме ${personName}:`
            : " — вся команда:"}
      </div>
      <Hint>
        {preview.recipients.length === 0
          ? "Некому: ни у кого не привязан Telegram."
          : preview.recipients.map((person) => person.displayName).join(", ")}
      </Hint>

      {confirming ? (
        <>
          <div style={{ fontSize: "var(--app-text-meta)", lineHeight: 1.45 }}>
            Отправить {recipientsPhrase(preview.recipients.length)}? Отменить будет нельзя — сообщения уйдут сразу.
          </div>
          {/* Единственная primary блока — и только на втором шаге: первый тап
              лишь взводит, так что случайно разослать всем одним касанием нельзя. */}
          <ActionButton kind="primary" compact stretched loading={sending} disabled={sending} onClick={onSend}>
            {sending ? "Отправляю…" : "Да, разослать"}
          </ActionButton>
          <ActionButton compact stretched disabled={sending} onClick={onCancel}>
            Отмена
          </ActionButton>
        </>
      ) : (
        <>
          {/* Кнопка остаётся на месте и погашенной, причина — подписью под ней.
              Прежде непустой блокер её ЗАМЕНЯЛ текстом, и здесь это било сильнее,
              чем в консоли: блокер набран тем же серым мелким шрифтом, что соседние
              пояснения, то есть на месте кнопки человек видел ещё один абзац. */}
          <ActionButton compact stretched disabled={busy || preview.blocker != null} onClick={onArm}>
            {sendButtonLabel(preview)}
          </ActionButton>
          {preview.blocker ? <Hint>{preview.blocker}</Hint> : null}
        </>
      )}
    </>
  );
}

/** The link, readable and copyable — the reason this list exists. */
function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: "var(--app-text-meta)",
          fontFamily: "var(--tgui--font_family_mono, monospace)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--tgui--hint_color)",
        }}
      >
        {url}
      </span>
      <ActionButton
        compact
        onClick={() => {
          navigator.clipboard
            .writeText(url)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            // Clipboard is unavailable in an insecure context; the text above is
            // still selectable, so there is nothing to report.
            .catch(() => {});
        }}
      >
        {copied ? "✓" : "Копировать"}
      </ActionButton>
    </div>
  );
}

interface CardProps {
  birthday: UpcomingBirthday;
  today: string;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onSent: (delivered: number, intended: number) => void;
}

function BirthdayCard({ birthday, today, open, onToggle, onChanged, onSent }: CardProps) {
  const palette = personPalette(birthday.employeeId);
  const status = roundStatus(birthday.campaign, today);

  async function toggleAutoSend(birthday: UpcomingBirthday) {
    // Включить — флагом `armAutoSend`, а не готовой датой: дату считает сервер
    // по командному «сейчас», а не браузер по своим часам (баг из ledger — у
    // админа в другом часовом поясе дата в базе расходилась с командной).
    const patch = birthday.campaign?.autoSendOn ? { autoSendOn: null } : { armAutoSend: true };
    await apiClient.saveBirthdayRound(birthday.employeeId, patch);
    await onChanged();
  }

  return (
    <div className={open ? "ui-item ui-item--open" : "ui-item"}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              flex: "none", display: "grid", placeContent: "center", width: 34, height: 34,
              borderRadius: 999, fontSize: "var(--app-text-meta)", fontWeight: 700, background: palette.bg, color: palette.fg,
            }}
          >
            {initialsOf(birthday.displayName)}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "var(--app-text-body)", overflowWrap: "anywhere" }}>{birthday.displayName}</div>
            <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>{whenLabel(birthday)}</div>
          </div>
          <span style={{ flex: "none" }}>
            <StatusPill tone={TONE_PILL[status.tone]}>{status.label}</StatusPill>
          </span>
        </div>

        {/* Только пока сбор не ушёл. После рассылки `autoSendOn` в базе остаётся
            (гасить его нечем и незачем), и строка обещала бы вторую рассылку рядом
            с пилюлей «Разослано · 14» — все три дня, пока команда скидывается.
            Выключать тут тоже уже нечего: тик пропускает разосланный раунд сам.
            И только пока раунд активен: закрытый сервер вооружить отказывается,
            и без этой проверки тумблер молча ничего не делал бы 200-м ответом
            без единой правки — баг из ledger. */}
        {birthday.campaign?.collectUrl && birthday.campaign.sendCount === 0 && isCollectionActive(birthday.campaign, today) && (
          <Cell
            after={
              <Switch
                checked={Boolean(birthday.campaign.autoSendOn)}
                aria-label="Бот рассылает сам"
                onChange={() => void toggleAutoSend(birthday)}
              />
            }
            subtitle={
              autoSendLabel(birthday.campaign.autoSendOn, today) ??
              "Разошлёшь сам — бот ждёт твоей кнопки"
            }
          >
            Бот рассылает сам
          </Cell>
        )}

        {/* Главной кнопки у карточки нет: «Подготовить сбор» только раскрывает
            редактор, а рассылка — в его собственной карточке. */}
        <ActionButton compact stretched aria-expanded={open} onClick={onToggle}>
          {open ? "Свернуть" : status.tone === "sent" ? "Посмотреть" : "Подготовить сбор"}
        </ActionButton>
      </Card>

      {/* Редактор — своими карточками следом (см. `CollectionCard`): в одной
          карточке с «Подготовить сбор» у него были бы свои главные кнопки. */}
      {open && <BirthdayEditor birthday={birthday} today={today} onChanged={onChanged} onSent={onSent} />}
    </div>
  );
}

/**
 * Раунд дня рождения: ссылка, свой текст и день, в который бот толкнёт админов.
 *
 * Живёт отдельно от редактора сбора, потому что адресуется работником, а не
 * идентификатором раунда: раунда может ещё не быть — он заводится первым
 * сохранением, и до него у предпросмотра `id: 0`.
 */
function BirthdayEditor({ birthday, today, onChanged, onSent }: Omit<CardProps, "open" | "onToggle">) {
  const [collectUrl, setCollectUrl] = useState(birthday.campaign?.collectUrl ?? "");
  const [messageText, setMessageText] = useState(birthday.campaign?.messageText ?? "");
  const [scheduledSendOn, setScheduledSendOn] = useState(birthday.campaign?.scheduledSendOn ?? "");
  const [recipientGroupId, setRecipientGroupId] = useState<number | null>(birthday.campaign?.recipientGroupId ?? null);
  const [preview, setPreview] = useState<CollectionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  /** The send button arms itself first; the second tap is the one that sends. */
  const [confirming, setConfirming] = useState(false);

  async function loadPreview() {
    try {
      setPreview(await apiClient.getBirthdayPreview(birthday.employeeId));
    } catch (err) {
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
        scheduledSendOn: scheduledSendOn || null,
        recipientGroupId,
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
    <>
      <Card>
        {sent ? (
          <Hint>
            Уже разослано{birthday.campaign?.sentCount ? ` — ${recipientsPhrase(birthday.campaign.sentCount)}` : ""}.
            Повторная отправка отключена, чтобы никто не получил поздравление дважды.
          </Hint>
        ) : (
          <>
            <RecipientGroupField
              value={recipientGroupId}
              onChange={(id) => { setRecipientGroupId(id); setConfirming(false); }}
              sent={false}
              knownName={preview?.recipientGroupName}
              disabled={busy}
            />
            {/* Headers stay short — a phone-width `Input` ellipsises its own label,
                and «Ссылка на сбор (Сбербан…» tells you nothing the field doesn't. */}
            <Input
              header="Ссылка на сбор"
              type="url"
              inputMode="url"
              placeholder="https://..."
              value={collectUrl}
              disabled={busy}
              onChange={(e) => {
                setCollectUrl(e.target.value);
                setConfirming(false);
              }}
            />
            {/* A native date field: unlike the birthday itself this one has a real
                year, and the range is what the server enforces anyway. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={FIELD_LABEL_STYLE}>Напомнить мне</span>
              <input
                type="date"
                value={scheduledSendOn}
                disabled={busy}
                min={today}
                max={birthday.celebratedOn}
                aria-label="Дата напоминания о сборе"
                style={DATE_INPUT_STYLE}
                onChange={(e) => { setScheduledSendOn(e.target.value); setConfirming(false); }}
              />
              <Hint>В этот день бот напишет админам. Команде — по-прежнему только по твоему тапу.</Hint>
            </div>
            {/* The placeholder is a hint, not the default text: the default is shown
                in full right below, and putting it here too clipped mid-line. */}
            <Textarea
              header="Свой текст"
              rows={3}
              placeholder="Оставь пустым — уйдёт текст ниже"
              value={messageText}
              disabled={busy}
              onChange={(e) => {
                setMessageText(e.target.value);
                setConfirming(false);
              }}
            />
            {/* Главная кнопка формы; рассылка — в соседней карточке со своей. */}
            <ActionButton kind="primary" compact stretched loading={saving} disabled={busy} onClick={() => void handleSave()}>
              Сохранить
            </ActionButton>
          </>
        )}

        {sent && (
          <RecipientGroupField
            value={birthday.campaign?.recipientGroupId ?? null}
            onChange={() => {}}
            sent
            knownName={preview?.recipientGroupName}
          />
        )}

        {error && <div style={ERROR_STYLE}>{error}</div>}
      </Card>

      {preview && (
        preview.id === 0 ? (
          // Раунда ещё нет: предпросмотр — черновик, и рассылать пока нечего.
          // Первое «Сохранить» его и заводит.
          <Card>
            <div style={FIELD_LABEL_STYLE}>Уйдёт вот это:</div>
            <div style={MESSAGE_BOX_STYLE}>{preview.message}</div>
            <Hint>Сохрани — и появится кнопка рассылки.</Hint>
          </Card>
        ) : (
          <Card>
            <OwnerLine>{birthday.displayName}</OwnerLine>
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
          </Card>
        )
      )}

      {/* Отметки и у раунда ДР: скидываются на подарок ровно так же, а виновник
          в получатели не входит никогда — сюрприз этим не выдаётся. */}
      {birthday.campaign && (
        <PaymentsBlock
          collectionId={birthday.campaign.id}
          canRemind={birthday.campaign.sendCount > 0}
          subject={birthday.displayName}
        />
      )}
    </>
  );
}

// `lazy()` умеет только default-экспорт — тот же приём, что у `AdminAnnounce`.
export default AdminCollections;
