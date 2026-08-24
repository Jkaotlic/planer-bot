// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Checklist } from "../../api/client";
import { AdminChecklists } from "./AdminChecklists";

/**
 * Файл инструкции прикладывается из вебки.
 *
 * До 2026-08-24 экран умел только сказать «напиши боту /instruction»: браузер не
 * может положить документ в Telegram, и своего хранилища у сервера не было.
 * Теперь файл уходит на диск сервера, а бот пересылает его при первой рассылке.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIST: Checklist = {
  id: 5, name: "Обход 47-го", note: null, docUrl: null, docName: null, hasDoc: false,
  items: [{ id: 1, title: "Свет", note: null }], templateIds: [],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let state: Checklist[] = [];

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function mount(list: Checklist) {
  // Экран после каждого действия перечитывает список — мок отдаёт то, что в
  // `state`, чтобы «приложилось» было видно так же, как с настоящим сервером.
  state = [list];
  vi.spyOn(apiClient, "getChecklists").mockImplementation(async () => state);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminChecklists)));
  });
  await settle();
  // Карточка чек-листа раскрывается — поле файла живёт внутри.
  const head = host.querySelector("button[aria-expanded]") as HTMLButtonElement;
  await act(async () => head.click());
  await settle();
  return host;
}

async function pick(el: HTMLElement, file: File) {
  const input = el.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();
}

describe("файл инструкции из вебки", () => {
  it("уходит на сервер выбранным файлом", async () => {
    const upload = vi.spyOn(apiClient, "uploadChecklistDoc").mockImplementation(async (_id, file) => {
      const saved = { ...LIST, hasDoc: true, docName: file.name };
      state = [saved];
      return saved;
    });

    const el = await mount(LIST);
    await pick(el, new File(["x"], "Проверка 47.pdf", { type: "application/pdf" }));

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0]).toBe(5);
    expect((upload.mock.calls[0]![1] as File).name).toBe("Проверка 47.pdf");
    // Имя приложенного видно сразу — иначе непонятно, приложилось ли.
    expect(el.textContent ?? "").toContain("Проверка 47.pdf");
  });

  it("слишком большой файл объясняется словами", async () => {
    vi.spyOn(apiClient, "uploadChecklistDoc").mockRejectedValue(new Error("Файл больше 5 МБ — выбери поменьше"));

    const el = await mount(LIST);
    await pick(el, new File(["x"], "Огромное.pdf", { type: "application/pdf" }));

    expect(el.textContent ?? "").toContain("Файл больше 5 МБ");
  });

  it("путь через бота остаётся написан рядом", async () => {
    const el = await mount(LIST);
    expect(el.textContent ?? "").toContain("/instruction");
  });
});
