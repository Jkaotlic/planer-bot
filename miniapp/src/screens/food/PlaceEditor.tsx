import { useState } from "react";
import { Input } from "@telegram-apps/telegram-ui";
import { FOOD_MENU_FULL_HINT, FOOD_MENU_MAX, placeMenuFromRows, placeRowsFromMenu, priceDigits, type PlaceEditorRow } from "@planer/shared";
import { apiClient, type PlaceView } from "../../api/client";
import { ActionButton } from "../../ui";

/**
 * Место и его меню. Цена вводится строкой и переводится в число только при
 * сохранении: иначе поле «0» нельзя стереть до пустого, чтобы набрать «350».
 */
export function PlaceEditor({ place, onSaved, onCancel }: { place: PlaceView | null; onSaved(p: PlaceView): void; onCancel(): void }) {
  const [name, setName] = useState(place?.name ?? "");
  const [rows, setRows] = useState<PlaceEditorRow[]>(place ? placeRowsFromMenu(place.menu) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, next: Partial<PlaceEditorRow>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...next } : r)));

  async function save() {
    // Правила строк (пустое имя у существующего блюда, блюдо без цены) — общие с
    // консолью: `placeMenuFromRows`.
    const built = placeMenuFromRows(rows);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await apiClient.saveFoodPlace(place?.id ?? null, { name: name.trim(), menu: built.menu }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "16px var(--app-gutter) calc(24px + var(--app-inset-bottom))" }}>
      <h1 className="ui-screen__title">{place ? "Место" : "Новое место"}</h1>
      <Input header="Название" name="place-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
      {rows.map((r, i) => (
        // Ширина фиксируется на ОБЁРТКЕ, а не на самом `Input`: `style`,
        // переданный `Input`, ложится на внутренний `<input>`, а не на его
        // враппер telegram-ui — тот держит свою ширину независимо (замерено
        // Playwright на 320/360px, см. отчёт задачи), и без обёртки поле
        // «Блюдо» на 320px схлопывалось до 0.
        <div key={r.id ?? `new-${i}`} data-testid="dish-row" style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Input name={`dish-name-${i}`} placeholder="Блюдо" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} disabled={busy} />
          </div>
          <div style={{ width: 110, flex: "none" }}>
            <Input name={`dish-price-${i}`} placeholder="₽" inputMode="numeric" value={r.price}
              onChange={(e) => patch(i, { price: priceDigits(e.target.value) })} disabled={busy} />
          </div>
          <ActionButton compact kind="quiet" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} disabled={busy}>✕</ActionButton>
        </div>
      ))}
      {rows.length < FOOD_MENU_MAX ? (
        <ActionButton compact onClick={() => setRows((prev) => [...prev, { name: "", price: "", unit: "pcs", step: "" }])} disabled={busy}>+ Блюдо</ActionButton>
      ) : (
        <div style={{ color: "var(--tgui--hint_color)", fontSize: "var(--app-text-meta)" }}>{FOOD_MENU_FULL_HINT}</div>
      )}
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: "var(--app-text-meta)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <ActionButton kind="primary" onClick={save} disabled={busy || !name.trim()} loading={busy}>Сохранить</ActionButton>
        <ActionButton kind="quiet" onClick={onCancel} disabled={busy}>Отмена</ActionButton>
      </div>
    </div>
  );
}
