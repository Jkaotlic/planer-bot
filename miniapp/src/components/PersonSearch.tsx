import { Input } from "@telegram-apps/telegram-ui";
import { shouldShowPersonSearch } from "@planer/shared";

/** Тот же контракт, что у консольного `PersonSearch`, и тот же `aria-label`:
 *  правило «когда показывать» живёт в `shared`, а различается только оболочка —
 *  здесь компонент из telegram-ui, там голый input. */
export function PersonSearch({ value, onChange, count, disabled }: {
  value: string; onChange: (value: string) => void; count: number; disabled?: boolean;
}) {
  if (!shouldShowPersonSearch(count)) return null;
  return (
    <div style={{ padding: "2px 0 8px" }}>
      <Input type="search" aria-label="Поиск по имени" placeholder="Поиск по имени"
        value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
