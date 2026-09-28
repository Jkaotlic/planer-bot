// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { realClient } from "./client";

/**
 * «Что мне писать» — ручка `/api/me/notifications`, общая с мини-аппом.
 *
 * Путь не `/api/admin/…`: адресат берётся из токена, и разойдись он с сервером,
 * консоль молча получила бы 404 там, где мини-апп работает.
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

describe("уведомления админа в реальном клиенте консоли", () => {
  it("список — GET /api/me/notifications", async () => {
    const body = { kinds: [{ kind: "swaps", title: "Обмены сменами", hint: "", enabled: true }] };
    const spy = answer(body);
    await expect(realClient.getNoticePrefs()).resolves.toEqual(body);
    expect(String(spy.mock.calls[0]![0])).toBe("/api/me/notifications");
  });

  it("тумблер — PATCH /api/me/notifications с видом и значением", async () => {
    const spy = answer({ kind: "swaps", enabled: false });
    await expect(realClient.setNoticePref("swaps", false)).resolves.toEqual({ kind: "swaps", enabled: false });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe("/api/me/notifications");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ kind: "swaps", enabled: false });
  });
});
