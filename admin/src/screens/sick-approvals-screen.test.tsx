// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type SickApprovalRow } from "../api/client";
import { SickApprovalsScreen } from "./SickApprovalsScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function row(patch: Partial<SickApprovalRow> = {}): SickApprovalRow {
  return {
    id: 7, employeeId: 4, employeeName: "Даша", date: "2026-10-06", endDate: null,
    requestedAt: "2026-10-05T09:00:00.000Z", shiftLines: ["06.10 · Утро"], handoverForced: false, ...patch,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

async function mount(onChanged?: () => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(SickApprovalsScreen, { onChanged })); });
  await settle();
  return host;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку «${text}»`);
  return found;
}

describe("«На подтверждение» в консоли", () => {
  it("рисует работника, срок, смены и пометку о срочной передаче", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([row({ handoverForced: true })]);
    const el = await mount();
    expect(el.textContent).toContain("Даша");
    expect(el.textContent).toContain("Больничный");
    expect(el.textContent).toContain("06.10 · Утро");
    expect(el.textContent).toContain("передача запущена без ОК");
  });

  it("без срочной передачи пометки нет", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([row()]);
    expect((await mount()).textContent).not.toContain("передача запущена без ОК");
  });

  it("продление: говорит, что уже подтверждено", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([
      row({ date: "2026-10-06", endDate: "2026-10-10", approvedSpan: { date: "2026-10-06", endDate: "2026-10-08" } }),
    ]);
    const el = await mount();
    expect(el.textContent).toContain("Продление больничного");
    expect(el.textContent).toContain("Уже подтверждён");
  });

  it("пусто — «Больничных на подтверждение нет.»", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([]);
    expect((await mount()).textContent).toContain("Больничных на подтверждение нет.");
  });

  it("«✅ ОК» шлёт approveSickLeave(7), перечитывает список и зовёт onChanged", async () => {
    const get = vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([row()]);
    const approve = vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue(undefined);
    const onChanged = vi.fn();
    const el = await mount(onChanged);
    const before = get.mock.calls.length;
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await settle();
    expect(approve).toHaveBeenCalledWith(7);
    expect(get.mock.calls.length).toBeGreaterThan(before);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("«❌ Отклонить» требует подтверждения, затем шлёт rejectSickLeave(7)", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([row()]);
    const reject = vi.spyOn(apiClient, "rejectSickLeave").mockResolvedValue(undefined);
    const el = await mount();
    await act(async () => { buttonByText(el, "❌ Отклонить").click(); });
    expect(reject).not.toHaveBeenCalled();
    await act(async () => { buttonByText(el, "Да, отклонить").click(); });
    await settle();
    expect(reject).toHaveBeenCalledWith(7);
  });

  it("отказ сервера — текстом на карточке, onChanged не зовётся", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([row()]);
    vi.spyOn(apiClient, "approveSickLeave").mockRejectedValue(new Error("Уже подтвердил(а) Игорь"));
    const onChanged = vi.fn();
    const el = await mount(onChanged);
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await settle();
    expect(el.querySelector(".approval-card")?.textContent).toContain("Уже подтвердил(а) Игорь");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("список не загрузился — ошибка и «Повторить»", async () => {
    const get = vi.spyOn(apiClient, "getSickApprovals").mockRejectedValueOnce(new Error("сеть")).mockResolvedValue([row()]);
    const el = await mount();
    expect(el.textContent).toContain("сеть");
    await act(async () => { buttonByText(el, "Повторить").click(); });
    await settle();
    expect(get).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain("Даша");
  });
});
