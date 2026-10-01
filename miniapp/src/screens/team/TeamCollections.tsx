import { useEffect, useState } from "react";
import { formatDayMonth, formatMoney } from "@planer/shared";
import { apiClient, type WorkerCollection } from "../../api/client";
import { ActionButton, Card, Group, Hint } from "../../ui";

/**
 * «Идёт сбор» — секция сверху во вкладке «Команда».
 *
 * Ссылка в личке тонет за два дня, а сбор идёт неделю. Здесь она лежит там, где
 * её можно найти, не поднимая переписку.
 *
 * Своего сбора человек тут не видит: сервер его не отдаёт (`GET /api/collections`),
 * и это единственное место, где правило применяется — экран ничего не фильтрует
 * сам, чтобы правило нельзя было забыть повторить.
 *
 * Пустой список — секции нет вовсе. Заголовок «Идёт сбор» над надписью «сборов
 * нет» занимает место каждый день ради события, которое случается раз в месяц.
 * Отказ сервера — тоже ничего: график команды не должен пропадать из-за того,
 * что не загрузился сбор.
 */
export interface TeamCollectionsProps {
  emptyLabel?: string;
  /** Сказать наверх, что здесь только что отметились/сняли отметку — на нём
   *  считается метка «ждёт тебя» на вкладке «Сборы» (`App.tsx`), а этот экран
   *  о ней ничего не знает и знать не должен. */
  onPaidChanged?: (id: number, paid: boolean) => void;
}

export function TeamCollections({ emptyLabel, onPaidChanged }: TeamCollectionsProps = {}) {
  // `null` — ещё грузится, `"error"` — не загрузилось. Раньше оба состояния
  // были пустым списком, и своя вкладка говорила «сборов нет», пока данные
  // шли, и навсегда — если запрос упал.
  const [rows, setRows] = useState<WorkerCollection[] | null | "error">(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setRows(null);
    apiClient
      .getMyCollections()
      .then((loaded) => { if (alive) setRows(loaded); })
      .catch(() => { if (alive) setRows("error"); });
    return () => { alive = false; };
  }, [attempt]);

  // Во вкладке «Команда» (`emptyLabel` не передан) секции нет ни пока грузится,
  // ни при отказе: сбор там не главное, и отказ не должен уносить с экрана
  // график команды.
  if (rows === null) return emptyLabel ? <Hint>Загружаю сборы…</Hint> : null;
  if (rows === "error") {
    return emptyLabel ? (
      <Group>
        <Hint>Не удалось загрузить сборы.</Hint>
        <ActionButton compact onClick={() => setAttempt((n) => n + 1)}>
          Повторить
        </ActionButton>
      </Group>
    ) : null;
  }

  // Пустой список: во вкладке «Команда» секции нет вовсе, а на своей вкладке
  // молчать нельзя — пустой экран читался бы как «не загрузилось».
  if (rows.length === 0) {
    return emptyLabel ? <Hint>{emptyLabel}</Hint> : null;
  }
  const loaded = rows;

  return (
    <Group header={loaded.length === 1 ? "Идёт сбор" : "Идут сборы"}>
      {loaded.map((row) => (
        <CollectionCard key={row.id} row={row} onPaidChanged={onPaidChanged} />
      ))}
    </Group>
  );
}

/**
 * Повод и виновник — одной фразой через тире, в именительном.
 *
 * Та же форма, что в письме, которое человек уже получил от бота: `Свадьба —
 * Пётр Иванов`. Одно «Свадьба» в списке из трёх сборов не говорит ничего, а
 * склонять нечем — в базе лежит только `display_name`.
 */
function subjectOf(row: WorkerCollection): string {
  return row.personName ? `${row.title} — ${row.personName}` : row.title;
}

function CollectionCard({ row, onPaidChanged }: { row: WorkerCollection; onPaidChanged?: (id: number, paid: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const [paid, setPaid] = useState(row.paid);
  const [paidCount, setPaidCount] = useState(row.paidCount);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const togglePaid = () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    apiClient
      .setCollectionPaid(row.id, !paid)
      .then((result) => {
        setPaid(result.paid);
        setPaidCount(result.paidCount);
        // Наверх — не пересчитать заново с сервера, а сказать ровно то, что уже
        // подтвердил ответ: метка «ждёт тебя» на вкладке иначе оставалась бы с
        // прежним числом до следующего фонового `reloadData`.
        onPaidChanged?.(row.id, result.paid);
      })
      // Отказ оставляет кнопку как была: галочка — это утверждение человека о
      // деньгах, и показать её, не записав, значит показать неправду. Но и
      // молчать нельзя: кнопка мигала и возвращалась, и это читалось как «не
      // работает». Чаще всего отказ значит, что сбор закрыли, пока экран был открыт.
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  const meta = [
    row.amountPerPerson != null ? `по ${formatMoney(row.amountPerPerson)}` : null,
    row.totalGoal != null ? `нужно ${formatMoney(row.totalGoal)}` : null,
    row.deadline ? `до ${formatDayMonth(row.deadline)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Card>
      <div style={{ fontWeight: 600, fontSize: "var(--app-text-body)" }}>{subjectOf(row)}</div>
      {/* Строки нет вовсе, когда в ней нечего писать: пустая даёт зазор, который
          читается как «тут что-то не загрузилось». */}
      {meta && (
        <div data-testid="collection-meta" style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
          {meta}
        </div>
      )}
      {row.collectUrl && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <a
            href={row.collectUrl}
            target="_blank"
            rel="noreferrer"
            style={{ flex: 1, fontSize: "var(--app-text-meta)", fontWeight: 600, color: "var(--tgui--link_color)" }}
          >
            Открыть сбор
          </a>
          {/* Ссылку можно и переслать — например, в семейный чат, откуда
              скидываются. Внутри Telegram открывшаяся страница банка возвращает
              не всех и не всегда. */}
          <ActionButton
            compact
            onClick={() => {
              navigator.clipboard
                .writeText(row.collectUrl!)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                // Clipboard is unavailable in an insecure context; the link
                // above still works, so there is nothing to report.
                .catch(() => {});
            }}
          >
            {copied ? "✓" : "Копировать"}
          </ActionButton>
        </div>
      )}
      {/* «Отметились», а не «сдали»: бот знает только то, что человек нажал
          кнопку, и подпись не должна утверждать больше, чем он проверял. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ActionButton kind={paid ? "secondary" : "primary"} compact disabled={busy} onClick={togglePaid}>
          {paid ? "Вы отметились ✓" : "Я перевёл"}
        </ActionButton>
        <span style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>
          отметились {paidCount} из {row.recipientCount}
        </span>
      </div>
      {/* Под кнопкой, в своей карточке: отказ, нарисованный над списком, уезжает
          за край экрана (см. `error-map.ts`). */}
      {failed && (
        <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>
          Не получилось отметить — возможно, сбор уже закрыли. Обнови экран.
        </div>
      )}
    </Card>
  );
}
