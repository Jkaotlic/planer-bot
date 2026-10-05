// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type SickApprovalRow } from "../../api/client";
import { AdminSickApprovals } from "./AdminSickApprovals";

/**
 * «На подтверждение»: что админ видит на карточке и что делают две кнопки. Кнопки
 * ищутся прямо в DOM без каких-либо раскрытий — они обязаны быть видны сразу.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROW: SickApprovalRow = {
  id: 7, employeeId: 4, employeeName: "Даша", date: "2026-10-06", endDate: "2026-10-08",
  requestedAt: "2026-10-05T09:00:00.000Z", shiftLines: ["Вт 6 окт · 08:00–17:00 · Утро"], handoverForced: true,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function mount(props: { onChanged?: () => void } = {}) {
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminSickApprovals, props)));
  });
  await settle();
  return host!;
}

function buttonByText(el: HTMLElement, text: string): HTMLElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`нет кнопки «${text}»`);
  return found as HTMLElement;
}

describe("«На подтверждение» в мини-аппе", () => {
  it("показывает кто, когда, какие смены и что передача уже запущена без ОК", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([ROW]);
    const el = await mount();
    expect(el.textContent).toContain("Даша");
    expect(el.textContent).toContain("с 6 по 8 октября");
    expect(el.textContent).toContain("Вт 6 окт · 08:00–17:00 · Утро");
    expect(el.textContent).toContain("передача запущена без ОК");
    // Обе кнопки на карточке сразу, без раскрытия.
    expect(buttonByText(el, "✅ ОК")).toBeTruthy();
    expect(buttonByText(el, "❌ Отклонить")).toBeTruthy();
  });

  it("без срочной передачи строки «запущена без ОК» нет", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([{ ...ROW, handoverForced: false }]);
    const el = await mount();
    expect(el.textContent).not.toContain("передача запущена без ОК");
  });

  it("продление называется продлением и показывает уже подтверждённый срок", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([
      { ...ROW, endDate: "2026-10-10", approvedSpan: { date: "2026-10-06", endDate: "2026-10-08" } },
    ]);
    const el = await mount();
    expect(el.textContent).toContain("Продление больничного");
    expect(el.textContent).toContain("Уже подтверждён с 6 по 8 октября");
  });

  it("«✅ ОК» подтверждает, перечитывает список и зовёт onChanged", async () => {
    const get = vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([ROW]).mockResolvedValue([]);
    const approve = vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue();
    const onChanged = vi.fn();
    const el = await mount({ onChanged });
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await settle();
    expect(approve).toHaveBeenCalledWith(7);
    expect(get).toHaveBeenCalledTimes(2);
    expect(onChanged).toHaveBeenCalled();
    expect(el.textContent).toContain("Больничных на подтверждение нет");
  });

  it("«Отклонить» спрашивает, и только «Да, отклонить» отклоняет", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([ROW]);
    const reject = vi.spyOn(apiClient, "rejectSickLeave").mockResolvedValue();
    const approve = vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue();
    const el = await mount();
    await act(async () => { buttonByText(el, "❌ Отклонить").click(); });
    expect(reject).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Запись удалится");
    await act(async () => { buttonByText(el, "Да, отклонить").click(); });
    await settle();
    expect(reject).toHaveBeenCalledWith(7);
    expect(approve).not.toHaveBeenCalled();
  });

  it("отказ сервера (другой админ успел) — текстом на карточке, а не молча", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([ROW]);
    vi.spyOn(apiClient, "approveSickLeave").mockRejectedValue(new Error("Уже подтвердил(а) Игорь"));
    const onChanged = vi.fn();
    const el = await mount({ onChanged });
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await settle();
    expect(el.textContent).toContain("Уже подтвердил(а) Игорь");
    // Решения не было — метку перечитывать не за чем.
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("список не загрузился — текст ошибки и «Повторить», который читает заново", async () => {
    const get = vi.spyOn(apiClient, "getSickApprovals").mockRejectedValueOnce(new Error("сеть")).mockResolvedValue([ROW]);
    const el = await mount();
    expect(el.textContent).toContain("сеть");
    await act(async () => { buttonByText(el, "Повторить").click(); });
    await settle();
    expect(get).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain("Даша");
  });
});
