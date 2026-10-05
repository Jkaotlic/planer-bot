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

  it("отказ сервера — текст виден, список и метка перечитываются, onChanged зовётся", async () => {
    // 409 «Уже подтвердил(а) …»: карточки после перечитывания уже нет, и текст
    // обязан пережить её, иначе админ не поймёт, что произошло.
    const get = vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([row()]).mockResolvedValue([]);
    vi.spyOn(apiClient, "approveSickLeave").mockRejectedValue(new Error("Уже подтвердил(а) Игорь"));
    const onChanged = vi.fn();
    const el = await mount(onChanged);
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await settle();
    expect(el.textContent).toContain("Уже подтвердил(а) Игорь");
    expect(get).toHaveBeenCalledTimes(2);
    expect(el.querySelector(".approval-card")).toBeNull();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("после отказа кнопки снова доступны, если карточка осталась", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([row()]);
    vi.spyOn(apiClient, "approveSickLeave").mockRejectedValue(new Error("сеть"));
    const el = await mount();
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await settle();
    expect(buttonByText(el, "✅ ОК").disabled).toBe(false);
  });

  it("два быстрых тапа — один запрос: после успеха кнопки выключены, пока карточка не убрана", async () => {
    // Перечитывание не отвечает: окно, в котором карточка ещё жива.
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([row()]).mockReturnValue(new Promise(() => {}));
    const approve = vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue(undefined);
    const el = await mount();
    const button = buttonByText(el, "✅ ОК");
    await act(async () => { button.click(); });
    await settle(3);
    await act(async () => { button.click(); });
    expect(button.disabled).toBe(true);
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("решение принято, а перечитать не вышло — так и говорит, не «не получилось»", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([row()]).mockRejectedValue(new Error("сеть"));
    vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue(undefined);
    const el = await mount();
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await settle();
    expect(el.textContent).toContain("Решение принято, но список не удалось обновить");
    expect(el.textContent).not.toContain("Не получилось");
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

  it("отказ сервера прокручивается в видимую часть: сообщение над длинным списком", async () => {
    // Кнопку нажали где-то внизу списка, сообщение стоит над ним — без прокрутки оно за краем экрана.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([row()]).mockResolvedValue([]);
    vi.spyOn(apiClient, "approveSickLeave").mockRejectedValue(new Error("Уже подтвердил(а) Игорь"));
    const el = await mount();
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await settle();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect((scroll.mock.contexts[0] as HTMLElement).textContent).toContain("Уже подтвердил(а) Игорь");
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

