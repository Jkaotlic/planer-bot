import { useState } from "react";
import { filterPeople } from "@planer/shared";
import { Card, Group } from "../ui";
import { PersonSearch } from "./PersonSearch";

/**
 * Выбор одного человека — списком с поиском вместо `<select>`.
 *
 * Зеркало консольного `PersonPicker` (`admin/src/components/PersonPicker.tsx`):
 * тот же контракт и то же правило «поиск не решает». Не `<select>`: на телефоне
 * он открывается системным колесом без всякого поиска, а людей под два десятка.
 * Строка «Выбран: …» стоит отдельно и поиску не подчиняется — иначе, отфильтровав
 * список, человек переставал видеть собственный выбор и переставлял его вслепую.
 *
 * Ряды — настоящие `<button type="button">` с `aria-pressed` и высотой не ниже
 * 44px: выбор одного из списка читается скринридером как переключатель, а не
 * как строка таблицы. Класс `person-picker-row` и `selected` — не для стилей, а
 * зацепка тестов и консольного зеркала.
 */
const rowStyle = (selected: boolean) =>
  ({
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%",
    minHeight: "var(--app-tap)", padding: "0 4px", background: "transparent", border: "none",
    borderTop: "1px solid var(--tgui--divider, rgb(128 128 128 / 18%))",
    font: "inherit", fontSize: "var(--app-text-body)", fontWeight: selected ? 600 : 400,
    color: "var(--tgui--text_color)", textAlign: "left", cursor: "pointer", overflowWrap: "anywhere",
  }) as const;

export function PersonPicker<T extends { id: number; displayName: string; preferredName?: string | null }>({
  label,
  people,
  value,
  onChange,
  emptyOptionLabel,
  disabled,
  note,
}: {
  label: string;
  people: readonly T[];
  /** 0 — «никто не выбран»; так же, как это уже кодировали `<select>`ы. */
  value: number;
  onChange: (id: number) => void;
  /** Подпись строки «никто», например «Общий сбор — на всех». Без неё строки нет. */
  emptyOptionLabel?: string;
  disabled?: boolean;
  /** Пометка рядом с именем, например «· вне назначений» — кого бот сам не поставил бы. */
  note?: (person: T) => string | null;
}) {
  const [query, setQuery] = useState("");

  // Объект, а не голое имя: строке «Выбран» ниже нужна и пометка `note`, а её
  // не достать из одного `displayName`.
  const chosenPerson = value === 0 ? null : people.find((p) => p.id === value);
  const chosenLabel = value === 0 ? emptyOptionLabel : chosenPerson?.displayName;
  const chosenMark = chosenPerson ? note?.(chosenPerson) : null;
  const filtered = filterPeople(people, query);

  return (
    <Group header={label}>
      <Card className="person-picker-card">
        {chosenLabel != null && (
          <div
            className="person-picker-chosen"
            style={{ fontSize: "var(--app-text-meta)", color: "var(--tgui--hint_color)", overflowWrap: "anywhere" }}
          >
            {/* Пометка обязана быть и здесь, не только в строке списка: список
                ограничен `maxHeight` со скроллом, и при паре десятков человек
                выбранная строка со своей пометкой запросто окажется вне
                видимой области — а «Выбран» существует именно на этот случай. */}
            Выбран: {chosenLabel}
            {chosenMark ? ` ${chosenMark}` : ""}
          </div>
        )}
        <PersonSearch value={query} onChange={setQuery} count={people.length} disabled={disabled} />
        {/* Ограничена по высоте с прокруткой: без этого два десятка строк
            растянули бы форму на весь экран. */}
        <div className="person-picker-list" style={{ maxHeight: 220, overflowY: "auto" }}>
          {/* type="button" — явно: у `<button>` без него тип по умолчанию
              `submit`. Сегодня на этих экранах нет родных `<form>`, поэтому не
              проявляется, но консольный зеркальный PersonPicker ставит
              `type="button"` явно — и здесь для того же: чтобы обе копии не
              разъезжались тихо. */}
          {emptyOptionLabel != null && (
            <button
              type="button"
              className={`person-picker-row${value === 0 ? " selected" : ""}`}
              aria-pressed={value === 0}
              disabled={disabled}
              style={rowStyle(value === 0)}
              onClick={() => onChange(0)}
            >
              <span>{emptyOptionLabel}</span>
              {value === 0 && <span aria-hidden="true">✓</span>}
            </button>
          )}
          {filtered.map((person) => {
            const mark = note?.(person);
            const selected = value === person.id;
            return (
              <button
                key={person.id}
                type="button"
                className={`person-picker-row${selected ? " selected" : ""}`}
                aria-pressed={selected}
                disabled={disabled}
                style={rowStyle(selected)}
                onClick={() => onChange(person.id)}
              >
                <span>
                  {person.displayName}
                  {mark ? ` ${mark}` : ""}
                </span>
                {selected && <span aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      </Card>
    </Group>
  );
}
