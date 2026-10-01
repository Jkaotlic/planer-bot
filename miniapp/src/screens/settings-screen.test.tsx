// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Me } from "../api/client";
import { SettingsScreen } from "./SettingsScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

const worker: Me = {
  id: 1, displayName: "Аня Смирнова", address: "Аня", preferredName: null,
  isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: false,
};

async function renderSettings(me: Me, onClose = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(AppRoot, null,
        createElement(SettingsScreen, {
          me, onClose,
          onRemindersChanged: vi.fn(), onStartTabChanged: vi.fn(),
          onSelfScheduleChanged: vi.fn(), onAddressChanged: vi.fn(),
        }),
      ),
    );
  });
  return { el: host, onClose };
}

describe("экран «Настройки»", () => {
  it("несёт все четыре блока, в порядке: уведомления, открывать сразу, календарь, обращение", async () => {
    const { el } = await renderSettings(worker);
    const text = el.textContent!;
    const order = ["Напоминания о сменах", "Открывать сразу", "Календарь", "Обращение"].map((s) => text.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(el.querySelector("h1")!.textContent).toBe("Настройки");
  });

  it("«Веду график сам» есть у наблюдателя и нет у обычного работника", async () => {
    const plain = await renderSettings(worker);
    expect(plain.el.textContent).not.toContain("Веду свой график сам");
    await act(async () => root!.unmount());
    host!.remove();

    const observer = await renderSettings({ ...worker, isObserver: true });
    expect(observer.el.textContent).toContain("Веду свой график сам");
  });

  it("«Назад» зовёт onClose", async () => {
    const { el, onClose } = await renderSettings(worker);
    await act(async () => (el.querySelector('button[aria-label="Назад"]') as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("пояснение под напоминаниями — одна короткая фраза, без перечня видов смен", async () => {
    const { el } = await renderSettings(worker);
    expect(el.textContent).toContain("Вечером накануне напишу про смену");
    expect(el.textContent).not.toContain("раннюю, утреннюю");
  });
});
