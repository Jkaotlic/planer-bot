import { useState, type ReactNode } from "react";
import { Section } from "@telegram-apps/telegram-ui";
import { ActionButton, Group } from "../ui";

/**
 * Секция с прошедшим: архив работников, закрытые сборы, завершённые обмены.
 *
 * Свёрнута по умолчанию — в этом весь смысл. Прошедшее не перестаёт
 * накапливаться, и без сворачивания оно отодвигает актуальное за край экрана:
 * админ листает тридцать архивных строк, чтобы дойти до того, зачем открыл
 * раздел.
 *
 * Пустая секция не рисуется совсем, а не показывает «архив пуст» — это был бы
 * ещё один заголовок, который надо прочитать и проигнорировать. То же решение,
 * что было принято для архива обменов, и теперь оно одно на всех, а не набрано
 * заново в каждом экране.
 *
 * `items` и отрисовка приходят раздельно, а счётчик считается по `items`:
 * заголовок «Архив · 7» не может разъехаться со списком под ним, потому что
 * второго источника числа просто нет.
 *
 * Контейнер выбирает вызывающий: без `plain` — `Section` telegram-ui, с фоном
 * карточки и разделителями (админские экраны отдают сюда голые строки и
 * рассчитывают на этот фон — под `Group`, который ничего не красит, они
 * ложились на холст без карточки); с `plain` — `Group` общего набора, для
 * экранов работника, где строки сами карточки.
 */
export function CollapsibleArchive<T>({
  title,
  items,
  children,
  plain = false,
}: {
  title: string;
  items: readonly T[];
  /** Отрисовка раскрытого списка. Ключи — на вызывающей стороне: она знает, что у её элементов id. */
  children: (items: readonly T[]) => ReactNode;
  plain?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const toggle = (
    <ActionButton kind="quiet" compact stretched onClick={() => setOpen(!open)}>
      {open ? "Свернуть" : `Показать · ${items.length}`}
    </ActionButton>
  );
  const header = `${title} · ${items.length}`;

  if (plain) {
    return (
      <Group header={header}>
        {toggle}
        {open && children(items)}
      </Group>
    );
  }
  return (
    <Section header={header}>
      <div style={{ padding: "10px 12px" }}>{toggle}</div>
      {open && children(items)}
    </Section>
  );
}
