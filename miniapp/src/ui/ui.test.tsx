// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionButton, Card, Group, Hint, Screen, StatusPill } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(node: ReactElement): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // Spinner из telegram-ui читает платформу из контекста AppRoot; в приложении он всегда есть.
  await act(async () => root!.render(createElement(AppRoot, null, node)));
  return host;
}

describe("Screen", () => {
  it("заголовок экрана — единственный h1, подзаголовок под ним", async () => {
    const el = await render(createElement(Screen, { title: "Обмены", subtitle: "Кто с кем", children: "тело" }));
    const h1 = el.querySelectorAll("h1");
    expect(h1).toHaveLength(1);
    expect(h1[0].textContent).toBe("Обмены");
    expect(el.textContent!.indexOf("Обмены")).toBeLessThan(el.textContent!.indexOf("Кто с кем"));
  });

  it("без onBack кнопки «Назад» нет; с onBack — есть и зовёт его", async () => {
    const plain = await render(createElement(Screen, { title: "А", children: null }));
    expect(plain.querySelector('button[aria-label="Назад"]')).toBeNull();
    await act(async () => root!.unmount());
    host!.remove();

    const onBack = vi.fn();
    const el = await render(createElement(Screen, { title: "Настройки", onBack, children: null }));
    const back = el.querySelector('button[aria-label="Назад"]') as HTMLButtonElement;
    await act(async () => back.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("Screen: шапка и оверлей", () => {
  it("action стоит внутри шапки", async () => {
    const el = await render(
      createElement(Screen, { title: "Т", action: createElement("button", { id: "act" }, "+"), children: null }),
    );
    expect(el.querySelector("header #act")).not.toBeNull();
  });

  it("подзаголовок без заголовка не пропадает", async () => {
    const el = await render(createElement(Screen, { subtitle: "Только подпись", children: null }));
    expect(el.querySelector("header")!.textContent).toContain("Только подпись");
  });

  it("onBack делает экран оверлеем, без него класса нет", async () => {
    const plain = await render(createElement(Screen, { title: "А", children: null }));
    expect(plain.querySelector(".ui-screen")!.className).not.toContain("ui-screen--overlay");
    await act(async () => root!.unmount());
    host!.remove();
    const el = await render(createElement(Screen, { title: "А", onBack: () => {}, children: null }));
    expect(el.querySelector(".ui-screen")!.className).toContain("ui-screen--overlay");
  });
});

describe("Group", () => {
  it("подпись раздела — h2, стоит перед содержимым", async () => {
    const el = await render(createElement(Group, { header: "Входящие", children: createElement("p", null, "карточка") }));
    expect(el.querySelector("h2")!.textContent).toBe("Входящие");
    expect(el.textContent!.indexOf("Входящие")).toBeLessThan(el.textContent!.indexOf("карточка"));
  });

  it("без header подписи нет вовсе — пустой h2 читался бы скринридером", async () => {
    const el = await render(createElement(Group, { children: "x" }));
    expect(el.querySelector("h2")).toBeNull();
  });
});

describe("ActionButton", () => {
  it("вид по умолчанию — обычная; primary и quiet несут свой класс", async () => {
    const el = await render(
      createElement("div", null,
        createElement(ActionButton, { children: "Открыть" }),
        createElement(ActionButton, { kind: "primary", children: "Беру" }),
        createElement(ActionButton, { kind: "quiet", children: "Отмена" }),
      ),
    );
    const [a, b, c] = [...el.querySelectorAll("button")];
    expect(a.className).toContain("ui-btn--secondary");
    expect(b.className).toContain("ui-btn--primary");
    expect(c.className).toContain("ui-btn--quiet");
  });

  it("loading гасит кнопку и не зовёт onClick", async () => {
    const onClick = vi.fn();
    const el = await render(createElement(ActionButton, { loading: true, onClick, children: "Беру" }));
    const btn = el.querySelector("button")!;
    expect(btn.disabled).toBe(true);
    await act(async () => btn.click());
    expect(onClick).not.toHaveBeenCalled();
    // Подпись остаётся в DOM: кнопка не должна менять ширину и прыгать.
    expect(btn.textContent).toContain("Беру");
  });

  it("без loading подпись — ровно children, без спиннера", async () => {
    const el = await render(createElement(ActionButton, { children: "Не смогу" }));
    expect(el.querySelector("button")!.textContent).toBe("Не смогу");
    expect(el.querySelector(".ui-btn__spinner")).toBeNull();
  });

  it("compact и stretched добавляют свои классы, без них классов нет", async () => {
    const el = await render(
      createElement("div", null,
        createElement(ActionButton, { compact: true, children: "А" }),
        createElement(ActionButton, { stretched: true, children: "Б" }),
        createElement(ActionButton, { children: "В" }),
      ),
    );
    const [a, b, c] = [...el.querySelectorAll("button")];
    expect(a.className).toContain("ui-btn--compact");
    expect(a.className).not.toContain("ui-btn--stretched");
    expect(b.className).toContain("ui-btn--stretched");
    expect(b.className).not.toContain("ui-btn--compact");
    expect(c.className).not.toContain("ui-btn--compact");
    expect(c.className).not.toContain("ui-btn--stretched");
  });
});

describe("StatusPill / Card / Hint", () => {
  it("тон пилюли — в классе, текст — внутри", async () => {
    const el = await render(createElement(StatusPill, { tone: "need", children: "Нужен ответ" }));
    const pill = el.querySelector(".ui-pill")!;
    expect(pill.className).toContain("ui-pill--need");
    expect(pill.textContent).toBe("Нужен ответ");
  });

  it("flush-карточка помечена классом — строки внутри идут от края до края", async () => {
    const el = await render(createElement(Card, { flush: true, children: "x" }));
    expect(el.querySelector(".ui-card")!.className).toContain("ui-card--flush");
  });

  it("обычная карточка не flush", async () => {
    const el = await render(createElement(Card, { children: "x" }));
    expect(el.querySelector(".ui-card")!.className).not.toContain("ui-card--flush");
  });

  it("Hint — абзац с классом ui-hint", async () => {
    const el = await render(createElement(Hint, { children: "пояснение" }));
    expect(el.querySelector("p.ui-hint")!.textContent).toBe("пояснение");
  });
});
