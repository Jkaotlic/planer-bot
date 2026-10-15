import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createChecklist } from "../repo/checklists";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import { createEmployee } from "../repo/employees";
import { ENTRY_LOCATION_MAX, ENTRY_NOTE_MAX, ENTRY_TITLE_MAX, addDaysIso } from "@planer/shared";

/**
 * Предел тела считается по прочитанным байтам, а не по заголовку.
 *
 * `Content-Length` — слово клиента: chunked-запрос его не шлёт вовсе, и прежняя
 * проверка (`oversizedUpload`) такой запрос пропускала к `c.req.json()`, который
 * буферизовал его целиком. Процесс один на API и опрос бота — большое тело
 * задевает чат всей команды. Поэтому все тела здесь — потоки без длины.
 */

const config = testConfig();
const KB = 1024;

/** Поток из `total` байт кусками по `chunk`, без Content-Length. `pulled` — сколько сервер реально вычитал. */
function chunkedBody(total: number, chunk = 4 * KB, fill = 0x61) {
  const counter = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (counter.pulled >= total) {
        controller.close();
        return;
      }
      const size = Math.min(chunk, total - counter.pulled);
      counter.pulled += size;
      controller.enqueue(new Uint8Array(size).fill(fill));
    },
  });
  return { stream, counter };
}

function chunkedPost(path: string, stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request(`http://x${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: stream,
    duplex: "half",
  } as RequestInit);
}

const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "Аня" }) }, config.botToken);

async function adminToken(app: ReturnType<typeof createApp>): Promise<string> {
  const res = await app.request("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: initDataFor(111) }),
  });
  return ((await res.json()) as { token: string }).token;
}

function stage() {
  const db = makeTestDb();
  const docsDir = mkdtempSync(join(tmpdir(), "planer-body-"));
  return { db, app: createApp({ db, config: { ...config, docsDir } }) };
}

describe("предел тела /api/*", () => {
  it("chunked-тело без Content-Length сверх общего предела — 413 с русским текстом, до разбора", async () => {
    const { app } = stage();
    const { stream, counter } = chunkedBody(1024 * KB);
    const res = await app.request(chunkedPost("/api/auth", stream));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("Слишком большой запрос");
    // Остановился на пределе, а не дочитал мегабайт.
    expect(counter.pulled).toBeLessThan(128 * KB);
  });

  it("chunked-тело в пределах доходит до ручки целым", async () => {
    const { app } = stage();
    const body = new TextEncoder().encode(JSON.stringify({ initData: initDataFor(111) }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body.slice(0, 10));
        controller.enqueue(body.slice(10));
        controller.close();
      },
    });
    const res = await app.request(chunkedPost("/api/auth", stream));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { token?: string }).token).toBeTruthy();
  });

  it("заявленный Content-Length сверх предела — 413 сразу", async () => {
    const { app } = stage();
    const res = await app.request("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(10 * 1024 * KB) },
      body: "{}",
    });
    expect(res.status).toBe(413);
  });

  it("импорт ростера — своё большое исключение: 2 МБ проходят к ручке, больше 4 МБ — 413 с текстом про файл", async () => {
    const { app } = stage();
    const token = await adminToken(app);
    const auth = { Authorization: `Bearer ${token}` };

    const passes = await app.request(chunkedPost("/api/admin/roster/import/preview", chunkedBody(2 * 1024 * KB).stream, auth));
    expect(passes.status).not.toBe(413);

    const tooBig = await app.request(chunkedPost("/api/admin/roster/import/apply", chunkedBody(5 * 1024 * KB).stream, auth));
    expect(tooBig.status).toBe(413);
    expect(((await tooBig.json()) as { error: string }).error).toBe("Файл больше 1 МБ — загрузите месяц отдельно");
  });

  it("пачка записей (до 200 штук) — 200 КБ проходят к ручке", async () => {
    const { app } = stage();
    const token = await adminToken(app);
    const res = await app.request(
      chunkedPost("/api/admin/entries/bulk", chunkedBody(200 * KB).stream, { Authorization: `Bearer ${token}` }),
    );
    expect(res.status).not.toBe(413);
  });

  it("полная пачка: 200 записей с подписью, местом и заметкой по потолку кириллицей — проходит и пишется", async () => {
    const { db, app } = stage();
    const token = await adminToken(app);
    const anya = createEmployee(db, { displayName: "Аня" });
    // Кириллица — два байта в UTF-8: (200 + 200 + 1000) × 2 ≈ 2,8 КБ на запись,
    // × 200 ≈ 560 КБ — больше прежних 512 КБ.
    const entries = Array.from({ length: 200 }, (_, i) => ({
      date: addDaysIso("2026-11-02", i), category: "vacation", employeeId: anya.id,
      title: "я".repeat(ENTRY_TITLE_MAX), location: "я".repeat(ENTRY_LOCATION_MAX), note: "я".repeat(ENTRY_NOTE_MAX),
    }));
    const bytes = new TextEncoder().encode(JSON.stringify({ entries }));
    expect(bytes.byteLength).toBeGreaterThan(512 * KB);
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
    const res = await app.request(chunkedPost("/api/admin/entries/bulk", stream, { Authorization: `Bearer ${token}` }));
    expect(res.status).toBe(201);
  });

  it("файл инструкции чек-листа — 1 МБ проходит к ручке, больше 5 МБ с запасом — 413", async () => {
    const { db, app } = stage();
    const token = await adminToken(app);
    const list = createChecklist(db, "Утро");
    const auth = { Authorization: `Bearer ${token}`, "content-type": "multipart/form-data; boundary=x" };

    // Настоящая форма: у FormData-тела запрос тоже не знает длины заранее.
    const form = new FormData();
    form.append("file", new File([new Uint8Array(1024 * KB)], "Инструкция.pdf", { type: "application/pdf" }));
    const passes = await app.request(`/api/admin/checklists/${list.id}/doc`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(passes.status).toBe(200);

    const tooBig = await app.request(chunkedPost(`/api/admin/checklists/${list.id}/doc`, chunkedBody(6 * 1024 * KB).stream, auth));
    expect(tooBig.status).toBe(413);
  });

  it("/api/client-error читает не больше своих 4 КБ и всё равно отвечает 204", async () => {
    const { app } = stage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { stream, counter } = chunkedBody(1024 * KB, KB);
      const res = await app.request(chunkedPost("/api/client-error", stream));
      expect(res.status).toBe(204);
      expect(counter.pulled).toBeLessThanOrEqual(8 * KB);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("/api/client-error разбирает обычный отчёт как раньше", async () => {
    const { app } = stage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await app.request("/api/client-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "белый экран", userAgent: "iPhone OS 15_0", url: "/app" }),
      });
      expect(res.status).toBe(204);
      expect(String(warn.mock.calls[0]?.[0])).toContain("белый экран");
    } finally {
      warn.mockRestore();
    }
  });
});
