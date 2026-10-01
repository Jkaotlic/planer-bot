// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { CheckRow, MenuRow, Screen, SelectField } from "./index";

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
  await act(async () => root!.render(createElement(AppRoot, null, node)));
  return host;
}

describe("MenuRow", () => {
  it("кнопка с названием и пояснением; значок и шеврон скрыты от скринридера", async () => {
    const onClick = vi.fn();
    const el = await render(createElement(MenuRow, { icon: "📅", title: "Расписание", hint: "Кто когда работает", onClick }));
    const btn = el.querySelector("button.ui-menu-row") as HTMLButtonElement;
    expect(btn.textContent).toContain("Расписание");
    expect(btn.textContent).toContain("Кто когда работает");
    expect([...btn.querySelectorAll("[aria-hidden]")].map((n) => n.textContent)).toEqual(["📅", "›"]);
    await act(async () => btn.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("без hint пояснения в DOM нет", async () => {
    const el = await render(createElement(MenuRow, { icon: "🐞", title: "Баги", onClick: () => {} }));
    expect(el.querySelector(".ui-menu-row__hint")).toBeNull();
  });
});

describe("CheckRow", () => {
  it("клик по подписи зовёт onChange с обратным значением", async () => {
    const onChange = vi.fn();
    const el = await render(createElement(CheckRow, { checked: false, onChange, label: "Наблюдатель", hint: "смотрит график" }));
    const input = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(input.checked).toBe(false);
    await act(async () => (el.querySelector("label") as HTMLLabelElement).click());
    expect(onChange).toHaveBeenCalledWith(true);
    expect(el.textContent).toContain("смотрит график");
  });

  it("checked отражён в поле и в классе отметки", async () => {
    const el = await render(createElement(CheckRow, { checked: true, onChange: () => {}, label: "А" }));
    expect((el.querySelector("input") as HTMLInputElement).checked).toBe(true);
    expect(el.querySelector(".ui-check__box")!.className).toContain("ui-check__box--on");
  });

  it("disabled: поле погашено, onChange не зовётся", async () => {
    const onChange = vi.fn();
    const el = await render(createElement(CheckRow, { checked: false, disabled: true, onChange, label: "А" }));
    expect((el.querySelector("input") as HTMLInputElement).disabled).toBe(true);
    await act(async () => (el.querySelector("label") as HTMLLabelElement).click());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SelectField", () => {
  it("выбор зовёт onChange со значением option", async () => {
    const onChange = vi.fn();
    const el = await render(
      createElement(SelectField, {
        value: "1",
        onChange,
        "aria-label": "Месяц",
        // children в пропсах, а не аргументами createElement: иначе tsc не видит обязательный children.
        children: [
          createElement("option", { key: "1", value: "1" }, "января"),
          createElement("option", { key: "2", value: "2" }, "февраля"),
        ],
      }),
    );
    const select = el.querySelector(".ui-select select") as HTMLSelectElement;
    expect(select.getAttribute("aria-label")).toBe("Месяц");
    expect(select.value).toBe("1");
    select.value = "2";
    await act(async () => select.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onChange).toHaveBeenCalledWith("2");
  });
});

describe("Screen: назад с нижней панелью", () => {
  it("backLabel задаёт подпись и aria-label; tabBar оставляет резерв под панель", async () => {
    const el = await render(createElement(Screen, { title: "Баги", onBack: () => {}, backLabel: "Разделы", tabBar: true, children: null }));
    const back = el.querySelector('button[aria-label="Разделы"]') as HTMLButtonElement;
    expect(back.textContent).toBe("‹ Разделы");
    expect(el.querySelector(".ui-screen")!.className).not.toContain("ui-screen--overlay");
  });

  it("без tabBar экран с onBack остаётся оверлеем с подписью «Назад»", async () => {
    const el = await render(createElement(Screen, { title: "Настройки", onBack: () => {}, children: null }));
    expect(el.querySelector('button[aria-label="Назад"]')!.textContent).toBe("‹ Назад");
    expect(el.querySelector(".ui-screen")!.className).toContain("ui-screen--overlay");
  });
});
