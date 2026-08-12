import { describe, it, expect } from "vitest";
import type { KeyboardButton } from "grammy/types";
import { mainKeyboard, BTN_WEEK, BTN_MY_SHIFTS, BTN_REMINDERS, BTN_ADMIN } from "./keyboard";

const PUBLIC_URL = "https://x.keenetic.pro";

/**
 * Метка кнопки. В Bot API кнопка обычной клавиатуры — это либо объект, либо
 * просто строка, и тип `KeyboardButton` честно объявлен юнионом обоих. `Keyboard`
 * из grammy строит только объекты, но разбирать оба случая дешевле, чем
 * приведение типа, которое молча соврёт, если это когда-нибудь изменится.
 */
function labelOf(btn: KeyboardButton): string {
  return typeof btn === "string" ? btn : btn.text;
}

/** Все метки раскладки одним списком — для этих проверок разбивка по строкам не важна. */
function labels(kb: ReturnType<typeof mainKeyboard>): string[] {
  return kb.keyboard.flat().map(labelOf);
}

describe("mainKeyboard", () => {
  it("админу даёт кнопку админки", () => {
    expect(labels(mainKeyboard({ isAdmin: true, publicUrl: PUBLIC_URL }))).toContain(BTN_ADMIN);
  });

  it("обычному работнику кнопку админки не даёт — её единственный ответ был бы отказом", () => {
    expect(labels(mainKeyboard({ isAdmin: false, publicUrl: PUBLIC_URL }))).not.toContain(BTN_ADMIN);
  });

  it("работник получает график, мини-апп и напоминания — и ничего сверх того", () => {
    expect(labels(mainKeyboard({ isAdmin: false, publicUrl: PUBLIC_URL }))).toEqual([
      BTN_WEEK,
      BTN_MY_SHIFTS,
      BTN_REMINDERS,
    ]);
  });

  it("кнопка мини-аппа открывает его по адресу из конфига, а не по зашитому", () => {
    const kb = mainKeyboard({ isAdmin: false, publicUrl: "https://other.example" });
    const btn = kb.keyboard.flat().find((b) => labelOf(b) === BTN_MY_SHIFTS);
    expect(btn).toMatchObject({ web_app: { url: "https://other.example/app/" } });
  });

  it("клавиатура сжата по кнопкам и не сворачивается после нажатия", () => {
    const kb = mainKeyboard({ isAdmin: true, publicUrl: PUBLIC_URL });
    expect(kb.resize_keyboard).toBe(true);
    expect(kb.is_persistent).toBe(true);
  });
});
