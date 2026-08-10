import { describe, expect, it } from "vitest";
import {
  TEMPLATES,
  mockCreateCollection,
  mockGetCollections,
  mockGetCollectionPreview,
  mockSendCollection,
  mockGetBirthdayPreview,
  mockSaveBirthdayRound,
} from "./mock";

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

    // Вторая половина названия теста: раунд ДР после рассылки — наоборот,
    // дожать нельзя. id 2 — «Игорь Петров», у него есть дата рождения в
    // фикстуре, и это не viewer консоли (им становится первый isAdmin &&
    // isActive — id 1, «Аня Смирнова»), так что сюрприз-правило его не тронет.
    const BIRTHDAY_EMPLOYEE_ID = 2;
    const round = await mockSaveBirthdayRound(BIRTHDAY_EMPLOYEE_ID, { collectUrl: "https://example.test/dr" });
    expect((await mockGetBirthdayPreview(BIRTHDAY_EMPLOYEE_ID)).blocker).toBeNull();

    await mockSendCollection(round.id);
    expect((await mockGetBirthdayPreview(BIRTHDAY_EMPLOYEE_ID)).blocker).toBe("Уже разослано — повторная отправка отключена.");
  });

  it("сюрприз-правило: свой сбор не виден в списке и не открывается по id — чужой виден", async () => {
    // Viewer DEV-консоли — первый isAdmin && isActive в фикстуре: id 1, «Аня Смирнова».
    const VIEWER_EMPLOYEE_ID = 1;
    const hidden = await mockCreateCollection({ title: "Секретный сбор", employeeId: VIEWER_EMPLOYEE_ID });
    const visible = await mockCreateCollection({ title: "Открытый сбор" });

    const rows = await mockGetCollections();
    expect(rows.some((r) => r.collection.id === hidden.id)).toBe(false);
    expect(rows.some((r) => r.collection.id === visible.id)).toBe(true);

    await expect(mockGetCollectionPreview(hidden.id)).rejects.toThrow("not_found");
  });
});
