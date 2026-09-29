import { and, asc, eq, isNull } from "drizzle-orm";
import type { PlaceInput } from "@planer/shared";
import type { Db } from "../db/client";
import { foodMenuItems, foodPlaces, type FoodMenuItem } from "../db/schema";
import type { Result } from "../polls/poll-service";

export interface PlaceView {
  id: number;
  name: string;
  menu: { id: number; name: string; price: number }[];
}

function menuOf(db: Db, placeId: number) {
  return db.select({ id: foodMenuItems.id, name: foodMenuItems.name, price: foodMenuItems.price })
    .from(foodMenuItems)
    .where(and(eq(foodMenuItems.placeId, placeId), isNull(foodMenuItems.archivedAt)))
    .orderBy(asc(foodMenuItems.position), asc(foodMenuItems.id))
    .all();
}

export function getPlaceView(db: Db, id: number): PlaceView | null {
  const place = db.select().from(foodPlaces).where(and(eq(foodPlaces.id, id), isNull(foodPlaces.archivedAt))).get();
  return place ? { id: place.id, name: place.name, menu: menuOf(db, place.id) } : null;
}

export function listPlaces(db: Db): PlaceView[] {
  return db.select().from(foodPlaces).where(isNull(foodPlaces.archivedAt)).all()
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map((p) => ({ id: p.id, name: p.name, menu: menuOf(db, p.id) }));
}

export function createPlace(db: Db, input: PlaceInput, createdBy: number): PlaceView {
  const id = db.transaction((tx) => {
    const place = tx.insert(foodPlaces).values({ name: input.name, createdBy }).returning().get();
    input.menu.forEach((m, position) => {
      tx.insert(foodMenuItems).values({ placeId: place.id, name: m.name, price: m.price, position }).run();
    });
    return place.id;
  });
  return getPlaceView(db, id)!;
}

/**
 * Правка меню «по месту»: блюдо с `id` меняется, без `id` — добавляется,
 * пропавшее — архивируется. Не «стёр и записал заново»: тогда у каждого блюда
 * менялся бы id, и кнопки в уже разосланных письмах открытого заказа
 * перестали бы работать от любой правки опечатки.
 */
export function updatePlace(db: Db, id: number, input: PlaceInput): Result & { place?: PlaceView } {
  if (!getPlaceView(db, id)) return { ok: false, error: "Места больше нет." };
  const current = new Map(menuOf(db, id).map((m) => [m.id, m]));
  if (input.menu.some((m) => m.id != null && !current.has(m.id))) {
    return { ok: false, error: "В меню блюдо из другого места." };
  }
  db.transaction((tx) => {
    tx.update(foodPlaces).set({ name: input.name }).where(eq(foodPlaces.id, id)).run();
    const kept = new Set<number>();
    input.menu.forEach((m, position) => {
      if (m.id != null) {
        kept.add(m.id);
        tx.update(foodMenuItems).set({ name: m.name, price: m.price, position }).where(eq(foodMenuItems.id, m.id)).run();
      } else {
        tx.insert(foodMenuItems).values({ placeId: id, name: m.name, price: m.price, position }).run();
      }
    });
    for (const oldId of current.keys()) {
      if (!kept.has(oldId)) tx.update(foodMenuItems).set({ archivedAt: new Date() }).where(eq(foodMenuItems.id, oldId)).run();
    }
  });
  return { ok: true, place: getPlaceView(db, id)! };
}

export function archivePlace(db: Db, id: number): Result {
  const changed = db.update(foodPlaces).set({ archivedAt: new Date() })
    .where(and(eq(foodPlaces.id, id), isNull(foodPlaces.archivedAt))).run();
  return changed.changes > 0 ? { ok: true } : { ok: false, error: "Места больше нет." };
}

export function activeMenuItem(db: Db, placeId: number, menuItemId: number): FoodMenuItem | undefined {
  return db.select().from(foodMenuItems)
    .where(and(eq(foodMenuItems.id, menuItemId), eq(foodMenuItems.placeId, placeId), isNull(foodMenuItems.archivedAt)))
    .get();
}
