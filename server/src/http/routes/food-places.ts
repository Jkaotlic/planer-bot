import { Hono, type Context } from "hono";
import { placeInputSchema } from "@planer/shared";
import type { Config } from "../../config";
import type { Db } from "../../db/client";
import { recordAudit } from "../../repo/audit";
import { requireAuth, type Env } from "../middleware";
import { jsonBody } from "../json-body";
import { archivePlace, createPlace, getPlaceView, listPlaces, updatePlace } from "../../orders/place-service";

/**
 * Места и меню правит любой работник: меню общее, и если ждать админа ради
 * новой цены шаурмы, его просто перестанут вести.
 */
export function createFoodPlaceRoutes(db: Db, config: Config): Hono<Env> {
  const app = new Hono<Env>();
  const auth = requireAuth(db, config.jwtSecret);
  const parse = async (c: Context) => placeInputSchema.safeParse(await jsonBody(c));
  const invalid = (issues: unknown) => ({ error: "Проверь название, блюда и цены (целые рубли, до 100 000).", issues });

  app.get("/api/food-places", auth, (c) => c.json({ places: listPlaces(db) }));

  app.post("/api/food-places", auth, async (c) => {
    const parsed = await parse(c);
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    const place = createPlace(db, parsed.data, c.get("auth").employeeId);
    recordAudit(db, "food_place_changed", c.get("auth").employeeId, { placeId: place.id, name: place.name, action: "создано" });
    return c.json({ place }, 201);
  });

  app.put("/api/food-places/:id", auth, async (c) => {
    const parsed = await parse(c);
    if (!parsed.success) return c.json(invalid(parsed.error.issues), 400);
    const result = updatePlace(db, Number(c.req.param("id")), parsed.data);
    if (!result.ok) return c.json({ error: result.error }, 409);
    recordAudit(db, "food_place_changed", c.get("auth").employeeId, { placeId: result.place!.id, name: result.place!.name, action: "изменено" });
    return c.json({ place: result.place });
  });

  app.delete("/api/food-places/:id", auth, (c) => {
    const id = Number(c.req.param("id"));
    // Имя читается ДО архивации: `archivePlace` гасит место условным UPDATE
    // и своего имени в ответе не несёт, а строка журнала «Изменено место…»
    // без имени не отвечает на первый вопрос, который к ней возникает.
    const name = getPlaceView(db, id)?.name;
    const result = archivePlace(db, id);
    if (!result.ok) return c.json({ error: result.error }, 404);
    recordAudit(db, "food_place_changed", c.get("auth").employeeId, { placeId: id, name, action: "удалено" });
    return c.json({ ok: true });
  });

  return app;
}
