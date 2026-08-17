import { describe, it, expect } from "vitest";
import { ADMIN_NOTICE_KINDS, ADMIN_NOTICE_LABELS } from "./notifications";

describe("виды админских уведомлений", () => {
  // Не «у каждого вида есть подпись» — это уже гарантирует `Record<AdminNoticeKind, …>`
  // на уровне tsc, и такой тест не смог бы упасть никогда. Падает этот — на пустой
  // строке и на скопированном заголовке, а обе эти ошибки живые.
  it("у каждого вида непустые заголовок и пояснение", () => {
    for (const kind of ADMIN_NOTICE_KINDS) {
      const label = ADMIN_NOTICE_LABELS[kind];
      expect(label.title.trim(), kind).not.toBe("");
      expect(label.hint.trim(), kind).not.toBe("");
    }
  });

  it("заголовки различны — иначе в списке два одинаковых переключателя", () => {
    const titles = ADMIN_NOTICE_KINDS.map((kind) => ADMIN_NOTICE_LABELS[kind].title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
