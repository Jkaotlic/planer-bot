import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Employee } from "../../api/client";
import { EmployeeRow } from "./AdminEmployeesScreen";

/**
 * «Нажимаю 🔗 Ссылка и ничего не происходит.»
 *
 * Сервер отвечал 200 с живой t.me-ссылкой — рисовалась она в единственном месте:
 * карточкой в самой верхней секции «Новый работник». Кнопка же живёт в строке
 * работника, а активных в команде 28 плюс архив. Нажатие на любой строке ниже
 * первой-второй меняло экран только за пределами видимой области: ни ссылки, ни
 * ошибки, ни признака, что что-то вообще произошло.
 *
 * Строка обязана уметь показать ссылку у себя — там, где только что был палец.
 */
const unlinked: Employee = {
  id: 7,
  displayName: "Новичок Никита",
  isAdmin: false,
  isActive: true,
  telegramUserId: null,
  birthDate: null,
  address: "Никита",
  preferredName: null,
  excludedFromAssignment: false,
  excludedFromSwaps: false,
  isObserver: false,
  selfScheduleEnabled: false, remindersEnabled: true,
};

const INVITE = { inviteToken: "abc123", inviteLink: "https://t.me/planer_bot?start=abc123" };

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    // telegram-ui insists on its provider; the row is what we're actually asserting on.
    createElement(AppRoot, null, createElement(EmployeeRow, {
      employee: unlinked,
      actionLabel: "В архив",
      busy: false,
      onAction: () => {},
      onShowInvite: () => {},
      ...props,
    } as never)),
  );

describe("ссылка привязки показывается в той же строке, где её попросили", () => {
  it("строка рисует ссылку у себя, когда её дали", () => {
    const html = render({ invite: INVITE });
    expect(html).toContain(INVITE.inviteLink);
  });

  it("без ссылки строка выглядит как раньше — только кнопка", () => {
    const html = render({});
    expect(html).toContain("🔗 Ссылка");
    expect(html).not.toContain(INVITE.inviteLink);
  });

  it("у привязанного кнопки нет, и подсунутая ссылка ничего не рисует", () => {
    const html = render({ employee: { ...unlinked, telegramUserId: 555 }, invite: INVITE });
    expect(html).not.toContain("🔗 Ссылка");
    expect(html).not.toContain(INVITE.inviteLink);
  });
});
