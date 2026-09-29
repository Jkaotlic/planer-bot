import { describe, it, expect } from "vitest";
import type { KeyboardButton } from "grammy/types";
import { mainKeyboard, BTN_WEEK, BTN_MY_SHIFTS, BTN_FOOD, BTN_REMINDERS, BTN_ADMIN, BTN_BUG } from "./keyboard";

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
    expect(labels(mainKeyboard({ isAdmin: true, isObserver: false }))).toContain(BTN_ADMIN);
  });

  it("обычному работнику кнопку админки не даёт — её единственный ответ был бы отказом", () => {
    expect(labels(mainKeyboard({ isAdmin: false, isObserver: false }))).not.toContain(BTN_ADMIN);
  });

  it("работник получает график, вход в мини-апп, заказы, напоминания и кнопку «Проблема» — и ничего сверх того", () => {
    expect(labels(mainKeyboard({ isAdmin: false, isObserver: false }))).toEqual([BTN_WEEK, BTN_MY_SHIFTS, BTN_FOOD, BTN_REMINDERS, BTN_BUG]);
  });

  it("наблюдателю кнопки заказов нет — он смотрит со стороны, заказывать ему не с кем", () => {
    expect(labels(mainKeyboard({ isAdmin: false, isObserver: true }))).not.toContain(BTN_FOOD);
  });

  it("«Проблема» есть и у работника, и у админа — жалуется как раз работник, не только админ", () => {
    expect(labels(mainKeyboard({ isAdmin: false, isObserver: false }))).toContain(BTN_BUG);
    expect(labels(mainKeyboard({ isAdmin: true, isObserver: false }))).toContain(BTN_BUG);
  });

  /**
   * Сторож против уже случившегося дефекта, а не гипотетического.
   *
   * Кнопка `web_app` в *обычной* клавиатуре открывает мини-апп без `initData`:
   * Telegram документированно оставляет его пустым, если запуск пришёл из кнопки
   * клавиатуры («empty if the Mini App was launched from a keyboard button or
   * from inline mode»). Подписи нет — `POST /api/auth` отвечает 401, и человек
   * видит «Не удалось загрузить». Так и было с «Мои смены», «Больничный» и
   * «Мероприятие», пока они жили здесь.
   *
   * Проверка смотрит на отсутствие поля, а не на список меток: предыдущая версия
   * этого файла сверяла, что у кнопки есть `web_app` с нужным адресом, и была
   * зелёной всё время, пока кнопка не работала ни у кого. Вход в мини-апп теперь
   * живёт в inline-клавиатуре (`miniAppKeyboard` в `bot.ts`) — там `initData`
   * приходит подписанным.
   */
  it("не несёт ни одной web_app-кнопки — из обычной клавиатуры мини-апп открывается без подписи и падает с 401", () => {
    const buttons = mainKeyboard({ isAdmin: true, isObserver: false }).keyboard.flat();
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn).not.toHaveProperty("web_app");
    }
  });

  it("укладывается в две строки — по одной лишней строке на «Напоминания» и «Админку» уходило пол-экрана", () => {
    expect(mainKeyboard({ isAdmin: true, isObserver: false }).keyboard.map((row) => row.map(labelOf))).toEqual([
      [BTN_WEEK, BTN_MY_SHIFTS, BTN_FOOD],
      [BTN_REMINDERS, BTN_BUG, BTN_ADMIN],
    ]);
  });

  it("у не-админа вторая строка не пустеет, а остаётся с «Напоминаниями» и «Проблемой»", () => {
    expect(mainKeyboard({ isAdmin: false, isObserver: false }).keyboard.map((row) => row.map(labelOf))).toEqual([
      [BTN_WEEK, BTN_MY_SHIFTS, BTN_FOOD],
      [BTN_REMINDERS, BTN_BUG],
    ]);
  });

  it("клавиатура сжата по кнопкам и не сворачивается после нажатия", () => {
    const kb = mainKeyboard({ isAdmin: true, isObserver: false });
    expect(kb.resize_keyboard).toBe(true);
    expect(kb.is_persistent).toBe(true);
  });
});
