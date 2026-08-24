import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bot } from "grammy";
import { InputFile } from "grammy";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { createChecklistItem } from "../repo/checklist";
import { createChecklist, getChecklist, setTemplateChecklist, updateChecklist } from "../repo/checklists";
import { testConfig } from "../test-config";
import { runChecklistTick } from "./checklist-tick";
import type { Db } from "../db/client";

/**
 * Файл инструкции уходит дежурному ОДИН раз с диска.
 *
 * Ответ Telegram на первую отправку содержит `file_id`, и он же становится
 * кэшем: следующие отправки не читают диск и не гонят мегабайты через канал,
 * который держит и API, и long-polling бота.
 */
const config = testConfig();
const TODAY = "2026-08-24";

function fakeBot(fileId: string | null = "NEW_FILE_ID") {
  const sent: { to: number; text: string }[] = [];
  const docs: { to: number; doc: unknown }[] = [];
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); }),
      sendDocument: vi.fn(async (to: number, doc: unknown) => {
        docs.push({ to, doc });
        return fileId ? { document: { file_id: fileId } } : {};
      }),
    },
  };
  return { bot: bot as unknown as Bot, sent, docs };
}

function stage() {
  const db: Db = makeTestDb();
  const igor = createEmployee(db, { displayName: "Игорь", inviteToken: "inv-1" });
  linkTelegramAccount(db, "inv-1", 333);
  const duty = listActiveTemplates(db).find((t) => t.category === "duty")!;
  const list = createChecklist(db, "Обход 47-го");
  setTemplateChecklist(db, duty.id, list.id);
  createShift(db, { date: TODAY, start: "07:00", end: "16:00", employeeId: igor.id, category: "duty", templateId: duty.id });
  createChecklistItem(db, list.id, "Свет");
  return { db, list };
}

function writeDoc(name = "Проверка 47.pdf"): string {
  const dir = mkdtempSync(join(tmpdir(), "planer-doc-"));
  const path = join(dir, name);
  writeFileSync(path, "инструкция");
  return path;
}

describe("файл инструкции в утреннем сообщении", () => {
  it("шлёт файл с диска и запоминает file_id", async () => {
    const { db, list } = stage();
    updateChecklist(db, list.id, { docPath: writeDoc(), docName: "Проверка 47.pdf" });
    const { bot, docs } = fakeBot();

    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });

    expect(docs).toHaveLength(1);
    expect(docs[0]!.doc).toBeInstanceOf(InputFile);
    expect(getChecklist(db, list.id)!.docFileId).toBe("NEW_FILE_ID");
  });

  it("со знакомым file_id шлёт по нему, а не с диска", async () => {
    const { db, list } = stage();
    updateChecklist(db, list.id, { docPath: writeDoc(), docName: "Проверка 47.pdf", docFileId: "OLD" });
    const { bot, docs } = fakeBot();

    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });

    expect(docs[0]!.doc).toBe("OLD");
  });

  it("пропавший с диска файл не срывает рассылку списка", async () => {
    // Файл могли убрать руками, а чек-лист дежурному нужен всё равно.
    const { db, list } = stage();
    updateChecklist(db, list.id, { docPath: "/nope/gone.pdf", docName: "gone.pdf" });
    const { bot, sent, docs } = fakeBot();

    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });

    expect(docs).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Свет");
  });

  it("не запоминает file_id, которого Telegram не вернул", async () => {
    // Иначе в кэш легло бы `undefined`, и следующая отправка ушла бы в никуда.
    const { db, list } = stage();
    updateChecklist(db, list.id, { docPath: writeDoc(), docName: "Проверка 47.pdf" });
    const { bot } = fakeBot(null);

    await runChecklistTick(db, bot, config, { date: TODAY, time: "07:05" });

    expect(getChecklist(db, list.id)!.docFileId).toBeNull();
  });
});
