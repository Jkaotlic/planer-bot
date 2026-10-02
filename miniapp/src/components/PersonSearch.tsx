import { Input } from "@telegram-apps/telegram-ui";
import { shouldShowPersonSearch } from "@planer/shared";
import { Card } from "../ui";

/** Тот же контракт, что у консольного `PersonSearch`, и тот же `aria-label`:
 *  правило «когда показывать» живёт в `shared`, а различается только оболочка —
 *  здесь компонент из telegram-ui, там голый input. */
export function PersonSearch({ value, onChange, count, disabled, card }: {
  value: string; onChange: (value: string) => void; count: number; disabled?: boolean;
  /** Поле стоит прямо на холсте экрана, а не внутри карточки: без своей
   *  карточки оно рисовалось тёмным прямоугольником с острыми углами. Карточку
   *  рисует сам компонент, чтобы при малом списке (поле скрыто) пустой не
   *  оставалось. */
  card?: boolean;
}) {
  if (!shouldShowPersonSearch(count)) return null;
  const input = (
    <Input type="search" aria-label="Поиск по имени" placeholder="Поиск по имени"
      value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  );
  if (card) return <Card>{input}</Card>;
  return <div style={{ padding: "2px 0 8px" }}>{input}</div>;
}
