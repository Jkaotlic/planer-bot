import { useState } from "react";
import { ButtonCell, Section } from "@telegram-apps/telegram-ui";
import { filterPeople } from "@planer/shared";
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
 * Ряды — `ButtonCell`, а не `Cell`: он рендерится настоящей `<button>` по
 * умолчанию, а обычный `Cell` — обёрткой `<div>`, по которой клик в тесте
 * не сработал бы через семантику кнопки.
 */
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

  const chosenName = value === 0 ? emptyOptionLabel : people.find((p) => p.id === value)?.displayName;
  const filtered = filterPeople(people, query);

  return (
    <Section header={label}>
      {chosenName != null && (
        <div
          className="person-picker-chosen"
          style={{ padding: "8px 24px 4px", fontSize: 13, color: "var(--tgui--hint_color)" }}
        >
          Выбран: {chosenName}
        </div>
      )}
      <div style={{ padding: "0 12px 8px" }}>
        <PersonSearch value={query} onChange={setQuery} count={people.length} disabled={disabled} />
      </div>
      {/* Ограничена по высоте с прокруткой: без этого два десятка строк
          растянули бы форму на весь экран. */}
      <div className="person-picker-list" style={{ maxHeight: 220, overflowY: "auto" }}>
        {emptyOptionLabel != null && (
          <ButtonCell
            className={`person-picker-row${value === 0 ? " selected" : ""}`}
            aria-pressed={value === 0}
            after={value === 0 ? "✓" : undefined}
            disabled={disabled}
            onClick={() => onChange(0)}
          >
            {emptyOptionLabel}
          </ButtonCell>
        )}
        {filtered.map((person) => {
          const mark = note?.(person);
          return (
            <ButtonCell
              key={person.id}
              className={`person-picker-row${value === person.id ? " selected" : ""}`}
              aria-pressed={value === person.id}
              after={value === person.id ? "✓" : undefined}
              disabled={disabled}
              onClick={() => onChange(person.id)}
            >
              {person.displayName}
              {mark ? ` ${mark}` : ""}
            </ButtonCell>
          );
        })}
      </div>
    </Section>
  );
}
