import { useEffect, useState } from "react";
import {
  collectionStatus,
  describeDaysUntil,
  formatDayMonth,
  formatMoney,
  isCollectionActive,
} from "@planer/shared";
import { Button, Input, List, Placeholder, Section, Select, Spinner, Textarea } from "@telegram-apps/telegram-ui";
import {
  apiClient,
  type Collection,
  type CollectionPatch,
  type CollectionPreview,
  type CollectionRow,
  type Employee,
  type UpcomingBirthday,
} from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";
import { CollapsibleArchive } from "../../components/CollapsibleArchive";
import { ScreenScroll } from "../../components/ScreenScroll";
import { initialsOf, personPalette } from "../../lib/people";
import { toISODate } from "../../lib/week";
import { withNotifyNotice } from "../../lib/shift";

/**
 * «Сборы» (admin, mobile): деньги, которые команда скидывает — на день
 * рождения или по любому другому поводу.
 *
 * Правило, вокруг которого построен экран, — **бот никогда не пишет команде
 * сам.** За неделю до дня рождения он толкает админов; всё остальное здесь,
 * руками: вставить ссылку, поправить текст, прочитать точный текст и точный
 * поимённый список — и только потом отправить. Кнопка отправки сначала
 * взводится: на телефоне единственное действие, которое пишет сразу всем,
 * не должно быть в одном случайном тапе.
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
 * ничего не происходит, и чип про рассылку выглядел бы как приглашение
 * дожать.
 */
export function statusOf(row: Pick<CollectionRow, "collection" | "status" | "active">): { label: string; tone: StatusTone } {
  // Короче консольных формулировок намеренно: на 390 чип делит строку с
  // поводом и датой, и «Готово к отправке» роняло вторую строку.
  if (!row.active) return { label: "Закрыт", tone: "pending" };
  if (row.status === "sent") return { label: `Разослано · ${row.collection.sentCount}`, tone: "sent" };
  if (row.status === "ready") return { label: "Готово", tone: "ready" };
  return { label: "Нет ссылки", tone: "pending" };
}

/**
 * Тот же чип для раунда дня рождения из списка ближайших.
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

const TONE_COLOR: Record<StatusTone, string> = {
  sent: "var(--tgui--link_color)",
  ready: "var(--tgui--link_color)",
  pending: "var(--tgui--hint_color)",
};

const DATE_INPUT_STYLE = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--tgui--outline)",
  background: "var(--tgui--secondary_bg_color)",
  color: "var(--tgui--text_color)",
  font: "inherit",
  fontSize: 13.5,
} as const;

export function AdminCollections() {
  const today = toISODate(new Date());
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
      <ScreenScroll>
        <List>
          <Section header="Сборы">
            <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
              <Spinner size="m" />
            </div>
          </Section>
        </List>
      </ScreenScroll>
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

  return (
    <ScreenScroll>
      <List>
        <Section header="Ближайшие дни рождения">
          <CardStack>
            <CardShell>
              <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
                За неделю до дня рождения бот напишет админам. Команде ничего не уходит, пока ты сам не нажмёшь
                «Разослать» — и не увидишь перед этим точный текст и поимённый список.
              </div>
            </CardShell>

            {error && (
              <CardShell>
                <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>
              </CardShell>
            )}

            {notice && (
              <CardShell>
                <div style={{ fontSize: 13.5 }}>{notice}</div>
              </CardShell>
            )}

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
          </CardStack>
        </Section>

        <Section header="Новый сбор">
          <CardStack>
            <NewCollectionForm
              employees={employees}
              viewerId={viewerId}
              onCreated={async () => {
                setNotice(null);
                await reloadEverything();
              }}
            />
          </CardStack>
        </Section>

        <Section header="Сборы">
          <CardStack>
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
          </CardStack>
        </Section>

        {/* Закрытые не мешают живым, но и не пропадают: их ещё открывают заново. */}
        <CollapsibleArchive title="Закрытые" items={closedRows}>
          {(closed) => (
            <CardStack>
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
            </CardStack>
          )}
        </CollapsibleArchive>
      </List>
    </ScreenScroll>
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
      await apiClient.createCollection({
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
      <CardShell>
        <Button size="s" mode="bezeled" stretched onClick={() => setOpen(true)}>
          + Новый сбор
        </Button>
      </CardShell>
    );
  }

  return (
    <CardShell>
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
      <Select
        header="Кому"
        value={employeeId}
        disabled={busy}
        onChange={(e) => setEmployeeId(Number(e.target.value))}
      >
        <option value={0}>Общий сбор — на всех</option>
        {employees
          .filter((e) => e.isActive && e.id !== viewerId)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.displayName}
            </option>
          ))}
      </Select>

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

      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <Button
          size="s"
          mode="filled"
          stretched
          loading={busy}
          disabled={!canCreate(title) || busy}
          onClick={() => void handleCreate()}
        >
          Создать
        </Button>
        <Button size="s" mode="gray" disabled={busy} onClick={() => { reset(); setOpen(false); }}>
          Отмена
        </Button>
      </div>
    </CardShell>
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
        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--tgui--hint_color)" }}>Дата события</span>
          <input
            type="date"
            value={eventDate}
            disabled={busy}
            aria-label="Дата события"
            style={DATE_INPUT_STYLE}
            onChange={(e) => onEventDate(e.target.value)}
          />
        </label>
        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--tgui--hint_color)" }}>Скинуться до</span>
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
  if (error) return <CardShell><div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div></CardShell>;
  if (!rows) return <CardShell><Spinner size="s" /></CardShell>;
  if (rows.length === 0) return <CardShell><div style={{ color: "var(--tgui--hint_color)", fontSize: 13.5 }}>{emptyLabel}</div></CardShell>;

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

  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{cardSubject(row)}</div>
          {subtitle && <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>{subtitle}</div>}
        </div>
        <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: TONE_COLOR[status.tone], textAlign: "right" }}>
          {status.label}
        </span>
      </div>

      {row.collection.collectUrl && <CopyableLink url={row.collection.collectUrl} />}

      <Button size="s" mode={open ? "gray" : "bezeled"} stretched onClick={onToggle}>
        {open ? "Свернуть" : "Открыть"}
      </Button>

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
    </CardShell>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      {!isBirthday && (
        <>
          <Input
            header="Повод"
            value={title}
            disabled={busy || subjectFrozen}
            onChange={(e) => { setTitle(e.target.value); setConfirming(false); }}
          />
          <Select
            header="Кому"
            value={employeeId}
            disabled={busy || subjectFrozen}
            onChange={(e) => { setEmployeeId(Number(e.target.value)); setConfirming(false); }}
          >
            <option value={0}>Общий сбор — на всех</option>
            {employees
              .filter((e) => e.isActive && e.id !== viewerId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.displayName}
                </option>
              ))}
          </Select>
          {subjectFrozen && (
            <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5, lineHeight: 1.4 }}>
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

      <Button size="s" mode="filled" stretched loading={saving} disabled={busy} onClick={() => void handleSave()}>
        Сохранить
      </Button>

      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>}

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

      <Button
        size="s"
        mode="bezeled"
        stretched
        loading={closing}
        disabled={busy}
        onClick={() => void handleClose(collection.closedAt == null)}
      >
        {collection.closedAt == null ? "Собрали, закрыть" : "Открыть заново"}
      </Button>

      {/* Удалить можно только то, о чём никто ещё не слышал: после рассылки
          люди уже получили письмо, и строка журнала про неё должна остаться
          осмысленной. Раунд дня рождения не удаляется вовсе — он выведен из
          даты рождения, и следующий проход завёл бы его заново. */}
      {!isBirthday && collection.sendCount === 0 && (
        <Button
          size="s"
          mode="plain"
          stretched
          loading={deleting}
          disabled={busy}
          style={{ color: "var(--tgui--destructive_text_color)" }}
          onClick={() => void handleDelete()}
        >
          Удалить сбор
        </Button>
      )}
    </div>
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
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5, fontWeight: 600 }}>Уйдёт вот это:</div>
      {/* Показано так, как придёт — те же переносы, и длинная ссылка переносится,
          а не выталкивает карточку за край экрана. */}
      <div
        style={{
          padding: "10px 12px", borderRadius: 10, background: "var(--tgui--secondary_bg_color)",
          fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}
      >
        {preview.message}
      </div>

      <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5, fontWeight: 600 }}>
        Получат {recipientsSubject(preview.recipients.length)}
        {personName ? ` — все, кроме ${personName}:` : " — вся команда:"}
      </div>
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
        {preview.recipients.length === 0
          ? "Некому: ни у кого не привязан Telegram."
          : preview.recipients.map((person) => person.displayName).join(", ")}
      </div>

      {preview.blocker ? (
        <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>{preview.blocker}</div>
      ) : confirming ? (
        <>
          <div style={{ fontSize: 13, lineHeight: 1.45 }}>
            Отправить {recipientsPhrase(preview.recipients.length)}? Отменить будет нельзя — сообщения уйдут сразу.
          </div>
          <Button size="s" mode="filled" stretched loading={sending} disabled={sending} onClick={onSend}>
            {sending ? "Отправляю…" : "Да, разослать"}
          </Button>
          <Button size="s" mode="gray" stretched disabled={sending} onClick={onCancel}>
            Отмена
          </Button>
        </>
      ) : (
        <Button size="s" mode="bezeled" stretched disabled={busy} onClick={onArm}>
          {sendButtonLabel(preview)}
        </Button>
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
          fontSize: 12.5,
          fontFamily: "var(--tgui--font_family_mono, monospace)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--tgui--hint_color)",
        }}
      >
        {url}
      </span>
      <Button
        size="s"
        mode="gray"
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
      </Button>
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

  return (
    <CardShell>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            flex: "none", display: "grid", placeContent: "center", width: 34, height: 34,
            borderRadius: 999, fontSize: 12, fontWeight: 700, background: palette.bg, color: palette.fg,
          }}
        >
          {initialsOf(birthday.displayName)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>{birthday.displayName}</div>
          <div style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>{whenLabel(birthday)}</div>
        </div>
        <span style={{ flex: "none", fontSize: 12, fontWeight: 600, color: TONE_COLOR[status.tone], textAlign: "right" }}>
          {status.label}
        </span>
      </div>

      <Button size="s" mode={open ? "gray" : "bezeled"} stretched onClick={onToggle}>
        {open ? "Свернуть" : status.tone === "sent" ? "Посмотреть" : "Подготовить сбор"}
      </Button>

      {open && <BirthdayEditor birthday={birthday} onChanged={onChanged} onSent={onSent} />}
    </CardShell>
  );
}

/**
 * Раунд дня рождения: ссылка, свой текст и день, в который бот толкнёт админов.
 *
 * Живёт отдельно от редактора сбора, потому что адресуется работником, а не
 * идентификатором раунда: раунда может ещё не быть — он заводится первым
 * сохранением, и до него у предпросмотра `id: 0`.
 */
function BirthdayEditor({ birthday, onChanged, onSent }: Omit<CardProps, "open" | "onToggle" | "today">) {
  const todayIso = toISODate(new Date());
  const [collectUrl, setCollectUrl] = useState(birthday.campaign?.collectUrl ?? "");
  const [messageText, setMessageText] = useState(birthday.campaign?.messageText ?? "");
  const [scheduledSendOn, setScheduledSendOn] = useState(birthday.campaign?.scheduledSendOn ?? "");
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
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
      {sent ? (
        <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
          Уже разослано{birthday.campaign?.sentCount ? ` — ${recipientsPhrase(birthday.campaign.sentCount)}` : ""}.
          Повторная отправка отключена, чтобы никто не получил поздравление дважды.
        </div>
      ) : (
        <>
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
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--tgui--hint_color)" }}>Напомнить мне</span>
            <input
              type="date"
              value={scheduledSendOn}
              disabled={busy}
              min={todayIso}
              max={birthday.celebratedOn}
              aria-label="Дата напоминания о сборе"
              style={DATE_INPUT_STYLE}
              onChange={(e) => { setScheduledSendOn(e.target.value); setConfirming(false); }}
            />
            <span style={{ fontSize: 12.5, color: "var(--tgui--hint_color)", lineHeight: 1.4 }}>
              В этот день бот напишет админам. Команде — по-прежнему только по твоему тапу.
            </span>
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
          <Button size="s" mode="filled" stretched loading={saving} disabled={busy} onClick={() => void handleSave()}>
            Сохранить
          </Button>
        </>
      )}

      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13.5 }}>{error}</div>}

      {preview && (
        preview.id === 0 ? (
          // Раунда ещё нет: предпросмотр — черновик, и рассылать пока нечего.
          // Первое «Сохранить» его и заводит.
          <>
            <div style={{ color: "var(--tgui--hint_color)", fontSize: 12.5, fontWeight: 600 }}>Уйдёт вот это:</div>
            <div
              style={{
                padding: "10px 12px", borderRadius: 10, background: "var(--tgui--secondary_bg_color)",
                fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}
            >
              {preview.message}
            </div>
            <div style={{ color: "var(--tgui--hint_color)", fontSize: 13, lineHeight: 1.45 }}>
              Сохрани — и появится кнопка рассылки.
            </div>
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
    </div>
  );
}
