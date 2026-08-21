import { shouldShowPersonSearch } from "@planer/shared";

/**
 * Поле поиска над списком людей.
 *
 * Само решает, показываться ли: правило «на коротком списке поиска нет» одно на
 * все экраны, и разложенное по семи местам оно бы разъехалось. `count` — длина
 * списка ДО фильтрации, иначе поле исчезало бы под собственным запросом,
 * стоило отфильтровать список до пяти строк.
 */
export function PersonSearch({
  value,
  onChange,
  count,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  count: number;
  disabled?: boolean;
}) {
  if (!shouldShowPersonSearch(count)) return null;
  return (
    <input
      className="person-search"
      type="search"
      aria-label="Поиск по имени"
      placeholder="Поиск по имени"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
