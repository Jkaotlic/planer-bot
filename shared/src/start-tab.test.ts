import { describe, it, expect } from "vitest";
import { isStartTab, START_TABS, startTabFor, startTabScreen, startTabTeamWeek } from "./start-tab";

const worker = { isAdmin: false, isObserver: false };
const admin = { isAdmin: true, isObserver: false };
const observer = { isAdmin: false, isObserver: true };

describe("isStartTab", () => {
  it("узнаёт свои значения и отвергает чужие", () => {
    expect(isStartTab("team")).toBe(true);
    expect(isStartTab("nope")).toBe(false);
    expect(isStartTab(null)).toBe(false);
  });

  it("перечисляет ровно те вкладки, что есть в меню", () => {
    expect([...START_TABS]).toEqual(["mine", "team", "team_week", "swaps", "weekend", "collections", "admin"]);
  });
});

/**
 * «Команда — неделя» — не седьмая вкладка меню, а вкладка «Команда», открытая
 * сразу недельной сеткой: в меню внизу её нет и быть не должно. Поэтому выбор
 * хранится одним значением, а разбирается на две части здесь.
 */
describe("«Команда — неделя»", () => {
  it("ведёт на вкладку «Команда»", () => {
    expect(startTabScreen("team_week")).toBe("team");
    expect(startTabTeamWeek("team_week")).toBe(true);
  });

  it("обычная «Команда» открывается днём, как была", () => {
    expect(startTabScreen("team")).toBe("team");
    expect(startTabTeamWeek("team")).toBe(false);
  });

  it("остальные вкладки к неделе отношения не имеют", () => {
    expect(startTabScreen("mine")).toBe("mine");
    expect(startTabTeamWeek("mine")).toBe(false);
    expect(startTabTeamWeek(null)).toBe(false);
  });

  it("видна всем, кому видна «Команда», — включая наблюдателя", () => {
    expect(startTabFor({ saved: "team_week", deeplink: null, viewer: observer })).toBe("team_week");
    expect(startTabFor({ saved: "team_week", deeplink: null, viewer: worker })).toBe("team_week");
  });
});

describe("startTabFor", () => {
  it("без настройки открывает «Смены», как было всегда", () => {
    expect(startTabFor({ saved: null, deeplink: null, viewer: worker })).toBe("mine");
  });

  it("открывает выбранную вкладку", () => {
    expect(startTabFor({ saved: "team", deeplink: null, viewer: worker })).toBe("team");
  });

  it("ссылка из бота побеждает настройку", () => {
    // Кнопка «📣 Анонс» обещает конкретный экран. Настройка, перебивающая её,
    // сделала бы кнопку враньём.
    expect(startTabFor({ saved: "team", deeplink: "admin", viewer: admin })).toBe("admin");
  });

  it("работнику не открывает «Админ», даже если он там записан", () => {
    // Права могли снять после того, как выбор сохранился.
    expect(startTabFor({ saved: "admin", deeplink: null, viewer: worker })).toBe("mine");
  });

  it("наблюдателю не открывает «Обмены» и «Выходные»", () => {
    expect(startTabFor({ saved: "swaps", deeplink: null, viewer: observer })).toBe("mine");
    expect(startTabFor({ saved: "weekend", deeplink: null, viewer: observer })).toBe("mine");
  });

  it("наблюдателю оставляет то, что ему видно", () => {
    expect(startTabFor({ saved: "collections", deeplink: null, viewer: observer })).toBe("collections");
    expect(startTabFor({ saved: "team", deeplink: null, viewer: observer })).toBe("team");
  });

  it("недоступная вкладка из ссылки тоже откатывается", () => {
    expect(startTabFor({ saved: null, deeplink: "admin", viewer: worker })).toBe("mine");
  });

  it("мусор в настройке не роняет старт", () => {
    // Значение приходит из базы, а её правили руками не раз.
    expect(startTabFor({ saved: "нет такой вкладки", deeplink: null, viewer: worker })).toBe("mine");
  });

  it("админу открывает «Админ», если он его выбрал", () => {
    expect(startTabFor({ saved: "admin", deeplink: null, viewer: admin })).toBe("admin");
  });
});

describe("какие вкладки доступны кому", () => {
  it("работнику — всё, кроме админки", () => {
    for (const tab of ["mine", "team", "swaps", "weekend", "collections"] as const) {
      expect(startTabFor({ saved: tab, deeplink: null, viewer: worker }), tab).toBe(tab);
    }
  });
});
