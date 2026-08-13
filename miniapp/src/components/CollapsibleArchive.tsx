import { useState, type ReactNode } from "react";
import { Button, Section } from "@telegram-apps/telegram-ui";

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
 */
export function CollapsibleArchive<T>({
  title,
  items,
  children,
}: {
  title: string;
  items: readonly T[];
  /** Отрисовка раскрытого списка. Ключи — на вызывающей стороне: она знает, что у её элементов id. */
  children: (items: readonly T[]) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <Section header={`${title} · ${items.length}`}>
      <div style={{ padding: "10px 12px" }}>
        <Button size="s" mode="gray" stretched onClick={() => setOpen(!open)}>
          {open ? "Свернуть" : `Показать · ${items.length}`}
        </Button>
      </div>
      {open && children(items)}
    </Section>
  );
}
