// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ActionButton, CheckRow, MenuRow, Screen, SelectField, TAB_BAR_CLEARANCE, TapHeight } from "./index";

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

describe("CheckRow: aria-label", () => {
  it("aria-label уходит на поле, чтобы две галочки в одной строке различались", async () => {
    const el = await render(createElement(CheckRow, { checked: false, onChange: () => {}, label: "Допущен", "aria-label": "Игорь: допущен к «Ночь»" }));
    expect(el.querySelector("input")!.getAttribute("aria-label")).toBe("Игорь: допущен к «Ночь»");
  });

  it("без aria-label атрибута нет", async () => {
    const el = await render(createElement(CheckRow, { checked: false, onChange: () => {}, label: "А" }));
    expect(el.querySelector("input")!.hasAttribute("aria-label")).toBe(false);
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

describe("SelectField: подпись и ширина", () => {
  const options = [createElement("option", { key: "a", value: "a" }, "А"), createElement("option", { key: "b", value: "b" }, "Б")];

  it("label — настоящая <label>, привязанная к select; без aria-label имя поля берётся из неё", async () => {
    const el = await render(createElement(SelectField, { value: "a", onChange: () => {}, label: "Очередь идёт", children: options }));
    const select = el.querySelector("select") as HTMLSelectElement;
    const label = el.querySelector("label") as HTMLLabelElement;
    expect(label.textContent).toBe("Очередь идёт");
    expect(select.id).not.toBe("");
    expect(label.htmlFor).toBe(select.id);
    expect(select.hasAttribute("aria-label")).toBe(false);
  });

  it("два поля с подписью получают разные id", async () => {
    const el = await render(
      createElement("div", null,
        createElement(SelectField, { value: "a", onChange: () => {}, label: "Один", children: options }),
        createElement(SelectField, { value: "a", onChange: () => {}, label: "Два", children: options }),
      ),
    );
    const ids = [...el.querySelectorAll("select")].map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("без label подписи в DOM нет", async () => {
    const el = await render(createElement(SelectField, { value: "a", onChange: () => {}, "aria-label": "Месяц", children: options }));
    expect(el.querySelector("label")).toBeNull();
    expect(el.querySelector("select")!.getAttribute("aria-label")).toBe("Месяц");
  });

  it("stretched растягивает поле на ширину контейнера; без него — нет", async () => {
    const wide = await render(createElement(SelectField, { value: "a", onChange: () => {}, stretched: true, "aria-label": "М", children: options }));
    expect(wide.querySelector(".ui-select")!.className).toContain("ui-select--stretched");
    await act(async () => root!.unmount());
    host?.remove();
    const narrow = await render(createElement(SelectField, { value: "a", onChange: () => {}, "aria-label": "М", children: options }));
    expect(narrow.querySelector(".ui-select")!.className).not.toContain("ui-select--stretched");
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

describe("ActionButton: danger и aria-expanded", () => {
  it("danger добавляет класс разрушающего тона; без него класса нет", async () => {
    const el = await render(createElement("div", null,
      createElement(ActionButton, { danger: true, children: "Удалить" }),
      createElement(ActionButton, { children: "Сохранить" }),
    ));
    const [del, save] = [...el.querySelectorAll("button")];
    expect(del!.className).toContain("ui-btn--danger");
    expect(save!.className).not.toContain("ui-btn--danger");
  });

  it("danger не отнимает вид secondary: оба класса на месте", async () => {
    const el = await render(createElement(ActionButton, { danger: true, children: "Удалить" }));
    const cls = el.querySelector("button")!.className;
    expect(cls).toContain("ui-btn--secondary");
    expect(cls).toContain("ui-btn--danger");
  });

  it("aria-expanded уходит на кнопку как есть, без него атрибута нет", async () => {
    const el = await render(createElement("div", null,
      createElement(ActionButton, { "aria-expanded": true, children: "Свернуть" }),
      createElement(ActionButton, { "aria-expanded": false, children: "Показать" }),
      createElement(ActionButton, { children: "Просто" }),
    ));
    const [a, b, c] = [...el.querySelectorAll("button")];
    expect(a!.getAttribute("aria-expanded")).toBe("true");
    expect(b!.getAttribute("aria-expanded")).toBe("false");
    expect(c!.hasAttribute("aria-expanded")).toBe(false);
  });
});

describe("ui.css: что нельзя потерять", () => {
  // jsdom не считает раскладку, поэтому правила проверяются по тексту файла.
  // Не `?raw`: vitest отдаёт CSS пустым, пока не включена обработка стилей.
  const css = readFileSync(`${import.meta.dirname}/ui.css`, "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("невидимое поле галочки привязано к рисованной отметке (top/left)", () => {
    const r = rule(".ui-check__input");
    expect(r).toMatch(/top:\s*\d+px/);
    expect(r).toMatch(/left:\s*0/);
  });

  it("danger у secondary: запасной фон стоит ДО color-mix", () => {
    const r = rule(".ui-btn--secondary.ui-btn--danger");
    expect(r.indexOf("rgb(")).toBeGreaterThanOrEqual(0);
    expect(r.indexOf("rgb(")).toBeLessThan(r.indexOf("color-mix"));
  });

  it("резерв под нижнюю панель: константа и оба класса считают одно и то же", () => {
    // Расчёт без `calc(` и скобки: в CSS он стоит внутри другого `calc`.
    const core = TAB_BAR_CLEARANCE.replace(/^calc\(/, "").replace(/\)$/, "");
    expect(rule(".ui-screen")).toContain(core);
    expect(rule(".ui-page")).toContain(core);
  });

  it("сегменты внутри TapHeight не ниже 44px: и обёртка выше, и кнопка с min-height", () => {
    expect(rule(".ui-tap-height")).toMatch(/height:\s*calc\(var\(--app-tap\)\s*\+\s*4px\)/);
    expect(rule(".ui-tap-height button")).toContain("min-height: var(--app-tap)");
  });

  it("danger красит текст токеном destructive_text_color", () => {
    expect(rule(".ui-btn--danger")).toContain("--tgui--destructive_text_color");
  });
});

describe("TapHeight", () => {
  it("оборачивает детей в блок с классом высоты нажимаемого", async () => {
    const el = await render(createElement(TapHeight, null, createElement("span", { id: "x" }, "a")));
    const wrap = el.querySelector(".ui-tap-height")!;
    expect(wrap.querySelector("#x")).not.toBeNull();
  });
});

describe("SelectField: disabled и CheckRow без hint", () => {
  it("disabled гасит нативный select", async () => {
    const el = await render(createElement(SelectField, {
      value: "a", onChange: () => {}, disabled: true, "aria-label": "М",
      children: [createElement("option", { key: "a", value: "a" }, "А")],
    }));
    expect((el.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
  });

  it("без disabled select живой", async () => {
    const el = await render(createElement(SelectField, {
      value: "a", onChange: () => {}, "aria-label": "М",
      children: [createElement("option", { key: "a", value: "a" }, "А")],
    }));
    expect((el.querySelector("select") as HTMLSelectElement).disabled).toBe(false);
  });

  it("CheckRow без hint не рисует узел пояснения", async () => {
    const el = await render(createElement(CheckRow, { checked: false, onChange: () => {}, label: "А" }));
    expect(el.querySelector(".ui-check__hint")).toBeNull();
  });
});
