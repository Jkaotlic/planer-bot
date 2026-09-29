import { useState } from "react";
import { Button, Input, Title } from "@telegram-apps/telegram-ui";
import { FOOD_MENU_MAX } from "@planer/shared";
import { apiClient, type PlaceView } from "../../api/client";

type Row = { id?: number; name: string; price: string };

/**
 * Место и его меню. Цена вводится строкой и переводится в число только при
 * сохранении: иначе поле «0» нельзя стереть до пустого, чтобы набрать «350».
 */
export function PlaceEditor({ place, onSaved, onCancel }: { place: PlaceView | null; onSaved(p: PlaceView): void; onCancel(): void }) {
  const [name, setName] = useState(place?.name ?? "");
  const [rows, setRows] = useState<Row[]>(place?.menu.map((m) => ({ id: m.id, name: m.name, price: String(m.price) })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, next: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...next } : r)));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const menu = rows.filter((r) => r.name.trim()).map((r) => ({ ...(r.id != null ? { id: r.id } : {}), name: r.name.trim(), price: Number(r.price) }));
      onSaved(await apiClient.saveFoodPlace(place?.id ?? null, { name: name.trim(), menu }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
      <Title level="2" weight="2">{place ? "Место" : "Новое место"}</Title>
      <Input header="Название" name="place-name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <Input name={`dish-name-${i}`} placeholder="Блюдо" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} disabled={busy} />
          <Input name={`dish-price-${i}`} placeholder="₽" inputMode="numeric" value={r.price}
            onChange={(e) => patch(i, { price: e.target.value.replace(/\D/g, "") })} disabled={busy} style={{ width: 90 }} />
          <Button size="s" mode="plain" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} disabled={busy}>✕</Button>
        </div>
      ))}
      {rows.length < FOOD_MENU_MAX && (
        <Button size="s" mode="bezeled" onClick={() => setRows((prev) => [...prev, { name: "", price: "" }])} disabled={busy}>+ Блюдо</Button>
      )}
      {error && <div style={{ color: "var(--tgui--destructive_text_color)", fontSize: 13 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="m" mode="filled" onClick={save} disabled={busy || !name.trim()} loading={busy}>Сохранить</Button>
        <Button size="m" mode="plain" onClick={onCancel} disabled={busy}>Отмена</Button>
      </div>
    </div>
  );
}
