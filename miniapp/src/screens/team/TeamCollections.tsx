import { useEffect, useState } from "react";
import { formatDayMonth, formatMoney } from "@planer/shared";
import { Button } from "@telegram-apps/telegram-ui";
import { apiClient, type WorkerCollection } from "../../api/client";
import { CardShell, CardStack } from "../../components/Card";

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
export function TeamCollections({ emptyLabel }: { emptyLabel?: string } = {}) {
  const [rows, setRows] = useState<WorkerCollection[]>([]);

  useEffect(() => {
    let alive = true;
    apiClient
      .getMyCollections()
      .then((loaded) => { if (alive) setRows(loaded); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  // Пустой список: во вкладке «Команда» секции нет вовсе (`emptyLabel` не
  // передан), а на своей вкладке молчать нельзя — пустой экран читался бы как
  // «не загрузилось».
  if (rows.length === 0) {
    return emptyLabel ? (
      <div style={{ color: "var(--tgui--hint_color)", fontSize: 13.5, padding: "12px 4px", lineHeight: 1.45 }}>
        {emptyLabel}
      </div>
    ) : null;
  }

  return (
    <CardStack>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--tgui--hint_color)", padding: "0 4px" }}>
        {rows.length === 1 ? "Идёт сбор" : "Идут сборы"}
      </div>
      {rows.map((row) => (
        <CollectionCard key={row.id} row={row} />
      ))}
    </CardStack>
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

function CollectionCard({ row }: { row: WorkerCollection }) {
  const [copied, setCopied] = useState(false);
  const meta = [
    row.amountPerPerson != null ? `по ${formatMoney(row.amountPerPerson)}` : null,
    row.totalGoal != null ? `нужно ${formatMoney(row.totalGoal)}` : null,
    row.deadline ? `до ${formatDayMonth(row.deadline)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <CardShell>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{subjectOf(row)}</div>
      {/* Строки нет вовсе, когда в ней нечего писать: пустая даёт зазор, который
          читается как «тут что-то не загрузилось». */}
      {meta && (
        <div data-testid="collection-meta" style={{ color: "var(--tgui--hint_color)", fontSize: 13 }}>
          {meta}
        </div>
      )}
      {row.collectUrl && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <a
            href={row.collectUrl}
            target="_blank"
            rel="noreferrer"
            style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: "var(--tgui--link_color)" }}
          >
            Открыть сбор
          </a>
          {/* Ссылку можно и переслать — например, в семейный чат, откуда
              скидываются. Внутри Telegram открывшаяся страница банка возвращает
              не всех и не всегда. */}
          <Button
            size="s"
            mode="gray"
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
          </Button>
        </div>
      )}
    </CardShell>
  );
}
