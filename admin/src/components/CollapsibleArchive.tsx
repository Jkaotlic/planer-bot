import { useState, type ReactNode } from "react";

/**
 * Секция с прошедшим: архив работников, закрытые сборы.
 *
 * Свёрнута по умолчанию. Прошедшее копится и отодвигает актуальное: в архиве
 * лежат все, кто когда-либо уходил, и пролистывать их, чтобы дойти до живого
 * списка, приходится каждый раз.
 *
 * Пустая секция не рисуется совсем — заголовок «Архив пуст» был ещё одной
 * строкой, которую надо прочитать и проигнорировать.
 *
 * Своя копия рядом с `miniapp/src/components/CollapsibleArchive.tsx`, а не общий
 * компонент на два воркспейса: тот собран из `@telegram-apps/telegram-ui`, этот —
 * из здешних классов (`employees-section`, `btn`), и общего у них ровно ноль
 * разметки. Пакета с общим UI в репозитории нет — `shared/` про доменные правила
 * и без React, — а заводить его ради одного тумблера значит менять устройство
 * проекта. Одинаковым тут обязано быть поведение, и оно описано этими двумя
 * докстрингами и проверено тестами по обе стороны.
 */
export function CollapsibleArchive<T>({
  title,
  items,
  children,
}: {
  title: string;
  items: readonly T[];
  /** Отрисовка раскрытого списка — вызывающая сторона знает, во что оборачивать строки. */
  children: (items: readonly T[]) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  return (
    <section className="employees-section">
      {/*
        Кнопка сама себе заголовок: раскрытие по нажатию на строку целиком —
        то, что человек пробует первым, и отдельная кнопка рядом с заголовком
        оставляла бы половину этой строки мёртвой.
      */}
      <button type="button" className="archive-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="archive-caret" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
        {title} · {items.length}
      </button>
      {open && children(items)}
    </section>
  );
}
