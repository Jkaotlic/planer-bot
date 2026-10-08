import { useEffect, useState } from "react";
import {
  FOOD_MENU_FULL_HINT, FOOD_NO_PLACES, FOOD_MENU_MAX, FOOD_TEXT_MAX, menuPreview, placeMenuFromRows, placeRowsFromMenu, priceDigits, type PlaceEditorRow,
} from "@planer/shared";
import { apiClient, type PlaceView } from "../../api/client";
import { ConfirmButton } from "../../components/ConfirmButton";
import { useAuthRequired } from "../../auth-required";
import { failureText } from "./food-errors";

type PlacesView = { mode: "list" } | { mode: "editor"; place: PlaceView | null };

/**
 * «Места и меню» — общие для всей команды: правит любой работник, ждать админа
 * ради новой цены шаурмы никто не будет (`server/src/http/routes/food-places.ts:10-13`).
 */
export function PlacesScreen({ onBack }: { onBack(): void }) {
  const onAuthRequired = useAuthRequired();
  const [view, setView] = useState<PlacesView>({ mode: "list" });
  const [places, setPlaces] = useState<PlaceView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Кто именно уходит в архив, а не общий флаг: иначе «Удалить» у одного места
  // гасило бы кнопки у всех.
  const [busyId, setBusyId] = useState<number | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    if (view.mode !== "list") return;
    let alive = true;
    setPlaces(null);
    setLoadError(null);
    apiClient.getFoodPlaces()
      .then((list) => { if (alive) setPlaces(list); })
      .catch((err) => { if (alive) setLoadError(failureText(err, "Не удалось загрузить.", onAuthRequired)); });
    return () => { alive = false; };
  }, [view, attempt]);

  if (view.mode === "editor") {
    return (
      <PlaceEditor
        place={view.place}
        onCancel={() => setView({ mode: "list" })}
        onSaved={() => { setView({ mode: "list" }); setAttempt((n) => n + 1); }}
      />
    );
  }

  async function archive(id: number) {
    setBusyId(id);
    setArchiveError(null);
    try {
      await apiClient.archiveFoodPlace(id);
    } catch (err) {
      setArchiveError(failureText(err, "Не удалось удалить место", onAuthRequired));
    } finally {
      setBusyId(null);
      // Перечитываем и после отказа: если место уже убрал кто-то другой, список
      // сам это покажет — а отказ стоит над списком, а не в исчезнувшей карточке.
      setAttempt((n) => n + 1);
    }
  }

  return (
    <div className="employees-screen">
      <button type="button" className="btn btn-quiet btn-compact" onClick={onBack}>‹ Назад</button>
      <div className="employees-header">
        <h2 className="employees-title">Места и меню</h2>
      </div>
      <div className="food-toolbar">
        <button type="button" className="btn btn-primary" onClick={() => setView({ mode: "editor", place: null })}>+ Место</button>
      </div>
      {archiveError && <div className="employees-error" role="alert">{archiveError}</div>}
      {loadError && (
        <div className="employees-error" role="alert">
          {loadError}{" "}
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => setAttempt((n) => n + 1)}>Повторить</button>
        </div>
      )}
      {places === null && !loadError && <div className="employees-empty">Загрузка…</div>}
      {places?.length === 0 && <div className="empty-state">{FOOD_NO_PLACES}</div>}
      {places && places.length > 0 && (
        <div className="food-list">
          {places.map((p) => (
            <article key={p.id} className="food-card">
              <div className="food-card-title">🍴 {p.name}</div>
              <div className="food-meta">{menuPreview(p.menu)}</div>
              <div className="food-buttons">
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => setView({ mode: "editor", place: p })}>Изменить</button>
                <ConfirmButton label="Удалить" question={`Удалить «${p.name}»?`} confirmLabel="Удалить" className="btn btn-secondary btn-compact"
                  disabled={busyId === p.id} onConfirm={() => void archive(p.id)} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Место и его меню. Цена — строкой, пока её набирают (иначе «0» не стереть до
 * пустого, чтобы набрать «350»); правила строк — `placeMenuFromRows`, общие с мини-аппом.
 */
export function PlaceEditor({ place, onSaved, onCancel }: {
  place: PlaceView | null;
  onSaved(p: PlaceView): void;
  onCancel(): void;
}) {
  const onAuthRequired = useAuthRequired();
  const [name, setName] = useState(place?.name ?? "");
  const [rows, setRows] = useState<PlaceEditorRow[]>(place ? placeRowsFromMenu(place.menu) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, next: Partial<PlaceEditorRow>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...next } : r)));

  async function save() {
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
      setError(failureText(err, "Не удалось сохранить", onAuthRequired));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="employees-screen employees-screen-form food-form">
      <h2 className="employees-title">{place ? "Место" : "Новое место"}</h2>
      <label className="birthday-label">
        Название
        <input type="text" aria-label="Название места" maxLength={FOOD_TEXT_MAX} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
      </label>
      {rows.map((r, i) => (
        <div key={r.id ?? `new-${i}`} className="food-dish-row" data-testid="dish-row">
          <input type="text" className="food-dish-name" aria-label={`Блюдо ${i + 1}`} placeholder="Блюдо" maxLength={FOOD_TEXT_MAX}
            value={r.name} disabled={busy} onChange={(e) => patch(i, { name: e.target.value })} />
          <input type="text" className="food-dish-price" aria-label={`Цена блюда ${i + 1}, ₽`} placeholder="₽" inputMode="numeric"
            value={r.price} disabled={busy} onChange={(e) => patch(i, { price: priceDigits(e.target.value) })} />
          <button type="button" className="btn btn-quiet btn-compact" aria-label={`Убрать блюдо ${i + 1}`} disabled={busy}
            onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      {rows.length < FOOD_MENU_MAX ? (
        <div className="food-buttons">
          <button type="button" className="btn btn-secondary btn-compact" disabled={busy}
            onClick={() => setRows((prev) => [...prev, { name: "", price: "", unit: "pcs", step: "" }])}>+ Блюдо</button>
        </div>
      ) : (
        <div className="food-meta">{FOOD_MENU_FULL_HINT}</div>
      )}
      {error && <div className="employees-error" role="alert">{error}</div>}
      <div className="food-buttons">
        <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}
