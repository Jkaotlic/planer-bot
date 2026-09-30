import { describe, expect, it } from "vitest";
import {
  mockCreateCollection, mockCreateRecipientGroup, mockDeleteRecipientGroup, mockGetCollectionPreview, mockGetRecipientGroups,
  mockSaveCollection, mockSaveRecipientGroup,
} from "./mock";

// Мок обязан отказывать теми же текстами, что сервис: в dev форму иначе не проверить.
describe("мок групп адресатов", () => {
  it("создаёт, правит, отказывает на дубль без учёта регистра и удаляет", async () => {
    const a = await mockCreateRecipientGroup({ name: "  Тест-группа  ", memberIds: [1, 1, 2] });
    expect(a.name).toBe("Тест-группа");
    expect(a.memberIds).toEqual([1, 2]);
    await expect(mockCreateRecipientGroup({ name: "тест-ГРУППА", memberIds: [] })).rejects.toThrow(
      "Группа с таким названием уже есть.",
    );
    const saved = await mockSaveRecipientGroup(a.id, { memberIds: [2] });
    expect(saved.memberIds).toEqual([2]);
    expect((await mockGetRecipientGroups()).map((g) => g.id)).toContain(a.id);
    await mockDeleteRecipientGroup(a.id);
    await expect(mockDeleteRecipientGroup(a.id)).rejects.toThrow("Группы больше нет.");
  });

  it("пустое имя и неизвестный человек — отказ", async () => {
    await expect(mockCreateRecipientGroup({ name: "   ", memberIds: [] })).rejects.toThrow("Проверь название");
    await expect(mockCreateRecipientGroup({ name: "Ещё", memberIds: [99999] })).rejects.toThrow("нет в команде");
  });

  it("список отсортирован по названию", async () => {
    const b = await mockCreateRecipientGroup({ name: "Яблоко", memberIds: [] });
    const a = await mockCreateRecipientGroup({ name: "Арбуз", memberIds: [] });
    const names = (await mockGetRecipientGroups()).map((g) => g.name);
    expect(names.indexOf("Арбуз")).toBeLessThan(names.indexOf("Яблоко"));
    await mockDeleteRecipientGroup(a.id);
    await mockDeleteRecipientGroup(b.id);
  });
});

// Сбор в моке держит группу так же, как сервер: имя удалённой не теряется, а
// «Такой группы нет.» отказывает только чужой удалённой.
describe("мок сборов с группой адресатов", () => {
  it("превью называет группу, удалённая блокирует, а свою удалённую сохранить можно", async () => {
    const g = await mockCreateRecipientGroup({ name: "Мок-группа", memberIds: [1, 2] });
    const c = await mockCreateCollection({ title: "С группой", collectUrl: "https://example.com/x", recipientGroupId: g.id });
    expect(c.recipientGroupId).toBe(g.id);
    expect((await mockGetCollectionPreview(c.id)).recipientGroupName).toBe("Мок-группа");

    await mockDeleteRecipientGroup(g.id);
    const after = await mockGetCollectionPreview(c.id);
    expect(after.recipientGroupName).toBe("Мок-группа");
    expect(after.blocker).toBe("Группа «Мок-группа» удалена — выбери другую.");
    await expect(mockSaveCollection(c.id, { recipientGroupId: g.id, collectUrl: "https://example.com/y" })).resolves.toBeTruthy();
    await expect(mockCreateCollection({ title: "Чужая", recipientGroupId: g.id })).rejects.toThrow("Такой группы нет.");
    await expect(mockSaveCollection(c.id, { recipientGroupId: 987654 })).rejects.toThrow("Такой группы нет.");
  });
});
