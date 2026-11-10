// @vitest-environment jsdom
import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { myWeekHtml } from "./my-week-html";

const state = { v: 1, m: "2026-11-09", t: "2026-11-10", d: 1, p: 0, n: 1, c: [["#aaa", "Д"], ["#ff0", "У"], null, null, null, null, null], e: { title: "Утро", time: "07:00–16:00", location: "Офис", hint: "" } };
function mount(initial = state) {
  const requests: string[] = [];
  const events = new Map<string, () => void>();
  let answer: { result: string | null } = { result: null };
  let error: Error | null = null;
  const bridge = { chatData: JSON.stringify(initial), onEvent: (name: string, fn: () => void) => events.set(name, fn), ready() {}, request: async (data: string) => { requests.push(data); if (error) throw error; return answer; } };
  const [markup, script] = myWeekHtml.split("<script>");
  document.body.innerHTML = markup!;
  Object.assign(window, { TelegramWidget: bridge });
  window.eval(script!.replace("</script>", ""));
  const dom = { window: { close() { document.body.innerHTML = ""; Reflect.deleteProperty(window, "TelegramWidget"); } } };
  const d = document;
  return { dom, d, bridge, requests, events, setAnswer(value: typeof answer) { answer = value; }, setError(value: Error) { error = value; } };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe("карточка недели", () => {
  it("рисует личный день до запроса и умещается в лимиты Telegram", async () => {
    const h = mount();
    await settle();
    try {
      expect(h.d.querySelectorAll(".day")).toHaveLength(7);
      expect(h.d.querySelector("#title")!.textContent).toBe("Утро");
      expect(h.d.querySelector("#time")!.textContent).toBe("07:00–16:00");
      expect(h.d.querySelector("#date")!.textContent).toContain("сегодня");
      expect(Buffer.byteLength(myWeekHtml)).toBeLessThanOrEqual(32768);
      expect(deflateSync(myWeekHtml, { level: 9 }).length).toBeLessThanOrEqual(4096);
    } finally { h.dom.window.close(); }
  });
  it("клик запрашивает нужный день, а рисует только состояние от сервера", async () => {
    const h = mount(); await settle();
    try {
      (h.d.querySelectorAll(".day")[3] as HTMLElement).click(); await settle();
      expect(h.requests.at(-1)).toBe("mw:2026-11-09:3:0");
      expect(h.d.querySelector("#title")!.textContent).toBe("Утро");
      h.bridge.chatData = JSON.stringify({ ...state, d: 3, e: { ...state.e, title: '<img src=x onerror="bad()">' } });
      h.events.get("chatDataChanged")!();
      expect(h.d.querySelector("#title")!.textContent).toBe('<img src=x onerror="bad()">');
      expect(h.d.querySelector("#title img")).toBeNull();
    } finally { h.dom.window.close(); }
  });
  it("стрелки считают абсолютную неделю и К сегодня просит командную дату", async () => {
    const h = mount(); await settle();
    try {
      (h.d.querySelector("#next") as HTMLElement).click(); await settle();
      expect(h.requests.at(-1)).toBe("mw:2026-11-16:1:0");
      (h.d.querySelector("#prev") as HTMLElement).click(); await settle();
      expect(h.requests.at(-1)).toBe("mw:2026-11-02:1:0");
      (h.d.querySelector("#today") as HTMLElement).click(); await settle();
      expect(h.requests.at(-1)).toBe("mw:today");
      expect(h.requests.every(r => Buffer.byteLength(r) <= 64)).toBe(true);
    } finally { h.dom.window.close(); }
  });
  it("несколько записей дня листаются без потери остальных", async () => {
    const h = mount({ ...state, n: 3 }); await settle();
    try {
      expect(h.d.querySelector("#counter")!.textContent).toBe("1 из 3");
      (h.d.querySelector("#entry-next") as HTMLElement).click(); await settle();
      expect(h.requests.at(-1)).toBe("mw:2026-11-09:1:1");
    } finally { h.dom.window.close(); }
  });
  it("обрыв сети снимает блокировку и даёт повторить обновление", async () => {
    const h = mount(); await settle(); h.setError(new Error("TIMEOUT"));
    try {
      (h.d.querySelector("#next") as HTMLElement).click(); await settle();
      expect(h.d.querySelector("#status")!.textContent).toContain("обновить");
      expect((h.d.querySelector("#refresh") as HTMLButtonElement).disabled).toBe(false);
      expect(h.d.querySelector("#title")!.textContent).toBe("Утро");
    } finally { h.dom.window.close(); }
  });
  it("после отзыва доступа скрывает прежние личные данные", async () => {
    const h = mount(); await settle(); h.setAnswer({ result: JSON.stringify({ error: "Моя неделя отключена", disabled: true }) });
    try {
      (h.d.querySelector("#refresh") as HTMLElement).click(); await settle();
      expect(h.d.querySelector("#detail")!.textContent).not.toContain("07:00");
      expect(h.d.querySelector("#status")!.textContent).toContain("отключена");
      expect(getComputedStyle(h.d.querySelector("#days")!).display).toBe("none");
      expect(getComputedStyle(h.d.querySelector("#entries")!).display).toBe("none");
    } finally { h.dom.window.close(); }
  });
  it("при возвращении запрашивает свежие данные той же даты", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const h = mount(); await settle();
    try {
      expect(h.requests).toHaveLength(1);
      now.mockReturnValue(16_000);
      h.events.get("activated")!(); await settle();
      expect(h.requests).toHaveLength(2);
      expect(h.requests.at(-1)).toBe("mw:2026-11-09:1:0");
    } finally { now.mockRestore(); h.dom.window.close(); }
  });
  it("для одной записи реально скрывает листалку, а не только ставит атрибут", async () => {
    const h = mount(); await settle();
    try {
      expect(getComputedStyle(h.d.querySelector("#entries")!).display).toBe("none");
    } finally { h.dom.window.close(); }
  });
});
