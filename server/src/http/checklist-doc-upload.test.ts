import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { MAX_DOC_BYTES, safeDocName } from "./checklist-doc";
import { makeTestDb } from "../db/testdb";
import { createChecklist, getChecklist, updateChecklist } from "../repo/checklists";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";

/**
 * Загрузка файла инструкции из браузера.
 *
 * Через бота файл кладётся давно, но браузер не умеет положить документ в
 * Telegram так, чтобы бот потом мог его переслать. Значит у сервера появляется
 * своё хранилище — и вместе с ним обязанности, которых у `file_id` не было:
 * не пустить в него слишком большой файл и не дать имени файла увести запись из
 * каталога.
 */
const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;

function stage() {
  const db = makeTestDb();
  const docsDir = mkdtempSync(join(tmpdir(), "planer-docs-"));
  const app = createApp({ db, config: { ...config, docsDir } });
  const list = createChecklist(db, "Обход 47-го");
  return { db, app, docsDir, list };
}

function upload(token: string, bytes: number, name = "Инструкция.pdf") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
  return { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form };
}

describe("safeDocName", () => {
  it("не даёт имени файла увести запись из каталога", () => {
    expect(safeDocName("../../etc/passwd")).toBe("passwd");
    expect(safeDocName("C:\\Users\\a\\Инструкция.pdf")).toBe("Инструкция.pdf");
  });

  it("подставляет имя, когда его нет", () => {
    // Файл без имени в сообщении дежурному выглядел бы поломкой.
    expect(safeDocName("   ")).toBe("Инструкция");
  });
});

describe("POST /api/admin/checklists/:id/doc", () => {
  it("кладёт файл на диск и показывает его в чек-листе", async () => {
    const { db, app, list } = stage();
    const res = await app.request(`/api/admin/checklists/${list.id}/doc`, upload(await tokenFor(app, 111), 1024));

    expect(res.status).toBe(200);
    const saved = getChecklist(db, list.id)!;
    expect(saved.docPath).toBeTruthy();
    expect(statSync(saved.docPath!).size).toBe(1024);
    expect(saved.docName).toBe("Инструкция.pdf");
    expect((await res.json()).checklist.hasDoc).toBe(true);
  });

  it("отказывает файлу больше пяти мегабайт", async () => {
    // Мини-апп открывают через релей на 11–58 КБ/с: большой файл — это не
    // «дольше», это забитый канал у процесса, который держит и API, и бота.
    const { db, app, list } = stage();
    const res = await app.request(`/api/admin/checklists/${list.id}/doc`, upload(await tokenFor(app, 111), MAX_DOC_BYTES + 1));

    expect(res.status).toBe(413);
    expect(getChecklist(db, list.id)!.docPath).toBeNull();
  });

  it("сбрасывает кэш file_id: иначе дежурным ушёл бы прежний документ", async () => {
    const { db, app, list } = stage();
    updateChecklist(db, list.id, { docFileId: "BQACAgIAAx", docName: "Старое.pdf" });

    await app.request(`/api/admin/checklists/${list.id}/doc`, upload(await tokenFor(app, 111), 512, "Новое.pdf"));

    const saved = getChecklist(db, list.id)!;
    expect(saved.docFileId).toBeNull();
    expect(saved.docName).toBe("Новое.pdf");
  });

  it("прежний файл не остаётся на диске", async () => {
    const { db, app, list } = stage();
    const token = await tokenFor(app, 111);
    await app.request(`/api/admin/checklists/${list.id}/doc`, upload(token, 256, "Старое.pdf"));
    const first = getChecklist(db, list.id)!.docPath!;

    await app.request(`/api/admin/checklists/${list.id}/doc`, upload(token, 256, "Новое.pdf"));

    expect(existsSync(first)).toBe(false);
    expect(existsSync(getChecklist(db, list.id)!.docPath!)).toBe(true);
  });

  it("удаление файла убирает его и с диска", async () => {
    const { db, app, list } = stage();
    const token = await tokenFor(app, 111);
    await app.request(`/api/admin/checklists/${list.id}/doc`, upload(token, 256));
    const path = getChecklist(db, list.id)!.docPath!;

    await app.request(`/api/admin/checklists/${list.id}/doc`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });

    expect(existsSync(path)).toBe(false);
    expect(getChecklist(db, list.id)!.docPath).toBeNull();
  });

  it("не пускает работника", async () => {
    const { db, app, list } = stage();
    createEmployee(db, { displayName: "Игорь", inviteToken: "inv-333" });
    linkTelegramAccount(db, "inv-333", 333);

    const res = await app.request(`/api/admin/checklists/${list.id}/doc`, upload(await tokenFor(app, 333), 128));

    expect(res.status).toBe(403);
    expect(getChecklist(db, list.id)!.docPath).toBeNull();
  });

  it("отказывает запросу без файла", async () => {
    const { app, list } = stage();
    const res = await app.request(`/api/admin/checklists/${list.id}/doc`, {
      method: "POST", headers: { Authorization: `Bearer ${await tokenFor(app, 111)}` }, body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("отказывает неизвестному чек-листу", async () => {
    const { app } = stage();
    const res = await app.request("/api/admin/checklists/9999/doc", upload(await tokenFor(app, 111), 64));
    expect(res.status).toBe(404);
  });
});
