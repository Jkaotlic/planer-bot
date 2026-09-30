import { describe, expect, it } from "vitest";
import { mockCreateRecipientGroup, mockDeleteRecipientGroup, mockGetRecipientGroups, mockSaveRecipientGroup } from "./mock";

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
});
