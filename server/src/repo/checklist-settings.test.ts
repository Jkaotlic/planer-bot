import { describe, expect, it } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import {
  clearChecklistDoc,
  clearDocPending,
  docPendingFor,
  readChecklistSettings,
  saveChecklistDoc,
  saveChecklistText,
  startDocPending,
} from "./checklist-settings";

/**
 * Инструкция дежурного тремя способами: текст, ссылка и файл в Telegram.
 * Всё три живут в `app_settings` — это настройки команды, а не сущность.
 */
describe("checklist settings", () => {
  it("новая база молчит по всем трём — ничего не засеяно", () => {
    expect(readChecklistSettings(makeTestDb())).toEqual({ note: null, docUrl: null, docFileId: null, docName: null });
  });

  it("хранит пояснение и ссылку, и умеет их стереть", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    saveChecklistText(db, { note: "Обходим по часовой", docUrl: "https://disk.example/47.pdf" }, anya.id);
    expect(readChecklistSettings(db)).toMatchObject({ note: "Обходим по часовой", docUrl: "https://disk.example/47.pdf" });

    saveChecklistText(db, { note: null, docUrl: null }, anya.id);
    expect(readChecklistSettings(db)).toMatchObject({ note: null, docUrl: null });
  });

  it("запоминает файл по его telegram-идентификатору и имени", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    saveChecklistDoc(db, { fileId: "BQACAgIAAx", fileName: "Проверка 47.pdf" }, anya.id);
    expect(readChecklistSettings(db)).toMatchObject({ docFileId: "BQACAgIAAx", docName: "Проверка 47.pdf" });

    clearChecklistDoc(db, anya.id);
    expect(readChecklistSettings(db)).toMatchObject({ docFileId: null, docName: null });
  });

  // Окно ожидания: бот попросил файл, и следующий документ от ЭТОГО админа
  // становится инструкцией. Без окна пришлось бы ловить любой файл от любого.
  it("держит окно ожидания файла и закрывает его", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    expect(docPendingFor(db, anya.id, new Date())).toBe(false);

    startDocPending(db, anya.id);
    expect(docPendingFor(db, anya.id, new Date())).toBe(true);
    // Чужой файл в это окно не попадает.
    expect(docPendingFor(db, anya.id + 1, new Date())).toBe(false);

    clearDocPending(db);
    expect(docPendingFor(db, anya.id, new Date())).toBe(false);
  });

  // «Отвлёкся и вернулся» — это пятнадцать минут, а не «через два часа
  // случайно прислал боту договор аренды».
  it("окно протухает через пятнадцать минут", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    startDocPending(db, anya.id);
    const later = new Date(Date.now() + 16 * 60_000);
    expect(docPendingFor(db, anya.id, later)).toBe(false);
  });
});
