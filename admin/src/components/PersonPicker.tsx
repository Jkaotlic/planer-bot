import { useState } from "react";
import { filterPeople } from "@planer/shared";
import { PersonSearch } from "./PersonSearch";

/**
 * Выбор одного человека — списком с поиском вместо `<select>`.
 *
 * Не `<select>`: на телефоне он открывается системным колесом, в котором нет
 * никакого поиска, а людей под два десятка. Строка «Выбран: …» стоит отдельно
 * и поиску не подчиняется — иначе, отфильтровав список, человек переставал
 * видеть собственный выбор и переставлял его вслепую.
 */
export function PersonPicker<T extends { id: number; displayName: string; preferredName?: string | null }>({
  label,
  people,
  value,
  onChange,
  emptyOptionLabel,
  disabled,
}: {
  label: string;
  people: readonly T[];
  /** 0 — «никто не выбран»; так же, как это уже кодировали `<select>`ы. */
  value: number;
  onChange: (id: number) => void;
  /** Подпись строки «никто», например «Общий сбор — на всех». Без неё строки нет. */
  emptyOptionLabel?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");

  const chosenName = value === 0 ? emptyOptionLabel : people.find((p) => p.id === value)?.displayName;
  const filtered = filterPeople(people, query);

  return (
    <div className="person-picker">
      <span className="field-label">{label}</span>
      {chosenName != null && <div className="person-picker-chosen">Выбран: {chosenName}</div>}
      <PersonSearch value={query} onChange={setQuery} count={people.length} disabled={disabled} />
      {/* `role="group" aria-label={label}` — иначе список ничем не связан с
          подписью над ним: у заменённых `<select>` было `aria-label="Кому"` /
          `aria-label="Кому сбор"`, и на «Сборах» с двумя пикерами их можно
          было различить по доступному имени, а у голого списка строк — нет. */}
      <div className="person-picker-list" role="group" aria-label={label}>
        {emptyOptionLabel != null && (
          <button
            type="button"
            className={`person-picker-row${value === 0 ? " selected" : ""}`}
            aria-pressed={value === 0}
            disabled={disabled}
            onClick={() => onChange(0)}
          >
            {emptyOptionLabel}
          </button>
        )}
        {filtered.map((person) => (
          <button
            key={person.id}
            type="button"
            className={`person-picker-row${value === person.id ? " selected" : ""}`}
            aria-pressed={value === person.id}
            disabled={disabled}
            onClick={() => onChange(person.id)}
          >
            {person.displayName}
          </button>
        ))}
      </div>
    </div>
  );
}
