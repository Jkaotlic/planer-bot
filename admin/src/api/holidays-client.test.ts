// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { realClient } from "./client";

/**
 * Праздничные ручки консоли — те же адреса и тела, что у мини-аппа.
 *
 * Сервер общий, и разойдись путь или тело — консоль молча получила бы 404/400
 * там, где мини-апп работает, а экран сказал бы только «не удалось».
 */

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function answer(body: unknown) {
  // Токен в хранилище, иначе клиент упрётся в отсутствие initData раньше сети.
  window.localStorage.setItem("adminToken", "token-for-the-test");
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
}

function sent(spy: ReturnType<typeof answer>) {
  const [url, init] = spy.mock.calls[0]!;
  return { url: String(url), method: init?.method, body: JSON.parse(String(init?.body ?? "null")) };
}

describe("праздники в реальном клиенте консоли", () => {
  it("автозагрузка — PUT /api/admin/settings/holidays-auto", async () => {
    const spy = answer({ enabled: false });
    await realClient.setHolidaysAuto(false);
    expect(sent(spy)).toEqual({ url: "/api/admin/settings/holidays-auto", method: "PUT", body: { enabled: false } });
  });

  it("«Обновить сейчас» — POST /api/admin/holidays/refresh, годы из ответа", async () => {
    const years = [{ year: 2026, status: "ok", added: 22, removed: 0 }];
    const spy = answer({ years });
    await expect(realClient.refreshHolidays()).resolves.toEqual(years);
    expect(sent(spy)).toMatchObject({ url: "/api/admin/holidays/refresh", method: "POST" });
  });

  it("отметка дня — PUT /api/admin/calendar/:date; снятая отметка отдаёт null", async () => {
    const spy = answer({ date: "2026-12-31", kind: null, note: null, source: null });
    await expect(realClient.setCalendarDay("2026-12-31", null)).resolves.toBeNull();
    expect(sent(spy)).toEqual({ url: "/api/admin/calendar/2026-12-31", method: "PUT", body: { kind: null, note: null } });
  });

  it("поставленная отметка возвращается строкой календаря", async () => {
    answer({ date: "2026-06-12", kind: "workday", note: null, source: "manual" });
    await expect(realClient.setCalendarDay("2026-06-12", "workday")).resolves.toEqual({
      date: "2026-06-12",
      kind: "workday",
      note: null,
      source: "manual",
    });
  });
});
