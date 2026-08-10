import { describe, expect, it } from "vitest";
import { TEMPLATES, mockCreateCollection, mockGetCollections, mockGetCollectionPreview, mockSendCollection } from "./mock";

describe("admin schedule mock", () => {
  it("mirrors the renamed 07:00 duty preset used by the real API", () => {
    expect(TEMPLATES.find((template) => template.id === 6)).toMatchObject({
      id: 6,
      name: "Дежурство с 07:00",
      category: "duty",
      accent: "amber",
      start: "07:00",
      end: "16:00",
      fridayStart: "07:00",
      fridayEnd: "14:45",
    });
  });
});

describe("мок сборов", () => {
  it("отдаёт заведённый сбор в списке и в предпросмотре", async () => {
    const created = await mockCreateCollection({ title: "Кофемашина", amountPerPerson: 1000 });
    const rows = await mockGetCollections();
    expect(rows.map((r) => r.title)).toContain("Кофемашина");

    const preview = await mockGetCollectionPreview(created.id);
    expect(preview.message).toContain("Скидываемся по 1 000 ₽");
    expect(preview.blocker).toContain("Нет ссылки");
  });

  it("после рассылки кастомный сбор можно дожать, а ДР нельзя", async () => {
    const created = await mockCreateCollection({ title: "Кофемашина", collectUrl: "https://example.test/c/1" });
    await mockSendCollection(created.id);
    expect((await mockGetCollectionPreview(created.id)).blocker).toBeNull();
    expect((await mockGetCollectionPreview(created.id)).sendCount).toBe(1);
  });
});
