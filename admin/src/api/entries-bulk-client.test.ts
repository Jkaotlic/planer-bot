// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { realClient } from "./client";

/**
 * «Заполнить неделю» — один POST `/api/admin/entries/bulk` с `{ entries }`.
 *
 * Тело — объект, а не голый массив: сервер ждёт поле `entries`, и массив
 * вместо него он отклонил бы целиком — неделя не встала бы ни одним днём.
 */

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("real createEntries client (консоль)", () => {
  it("шлёт все дни одним запросом и отдаёт итог из ответа", async () => {
    // Токен в хранилище, иначе клиент упрётся в отсутствие initData раньше сети.
    window.localStorage.setItem("adminToken", "token-for-the-test");
    const reply = { created: 2, notified: { delivered: 1, intended: 1 } };
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } }));
    const entries = [
      { date: "2026-06-08", category: "shift" as const, employeeId: 1 },
      { date: "2026-06-09", category: "vacation" as const, employeeId: 1 },
    ];

    await expect(realClient.createEntries(entries)).resolves.toEqual(reply);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe("/api/admin/entries/bulk");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ entries });
  });
});
