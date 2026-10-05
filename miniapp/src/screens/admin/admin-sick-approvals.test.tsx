// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type SickApprovalRow } from "../../api/client";
import { AdminSickApprovals } from "./AdminSickApprovals";
import { waitFor } from "../../test-wait";

/**
 * «На подтверждение»: что админ видит на карточке и что делают две кнопки. Кнопки
 * ищутся прямо в DOM без каких-либо раскрытий — они обязаны быть видны сразу.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Под нагрузкой полного набора ожидание условия длиннее обычного: таймаут теста не должен обрезать `waitFor`.
vi.setConfig({ testTimeout: 30_000 });

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
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

/**
 * Витки очереди микрозадач: нужны только перед утверждением «чего-то нет / не звали» — оно
 * проходило бы и до прихода ответа. Всё, что должно появиться, ждётся через `waitFor`.
 */
async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) await act(async () => {});
}

async function mount(props: { onChanged?: () => void } = {}) {
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminSickApprovals, props)));
  });
  // Список запрошен и разобран (карточка, пустое состояние или ошибка уже нарисованы).
  await waitFor(() => expect(vi.mocked(apiClient.getSickApprovals)).toHaveBeenCalled());
  await flush();
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
    await waitFor(() => {
      expect(approve).toHaveBeenCalledWith(7);
      expect(get).toHaveBeenCalledTimes(2);
      expect(onChanged).toHaveBeenCalled();
      expect(el.textContent).toContain("Больничных на подтверждение нет");
    });
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
    await waitFor(() => expect(reject).toHaveBeenCalledWith(7));
    await flush();
    expect(approve).not.toHaveBeenCalled();
  });

  it("отказ сервера (другой админ успел): текст виден, список перечитан, onChanged позван, карточки нет", async () => {
    const get = vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([ROW]).mockResolvedValue([]);
    vi.spyOn(apiClient, "approveSickLeave").mockRejectedValue(new Error("Уже подтвердил(а) Игорь"));
    const onChanged = vi.fn();
    const el = await mount({ onChanged });
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    // Устаревшая карточка с живыми кнопками — враньё: список перечитан, метка тоже.
    await waitFor(() => {
      expect(el.textContent).toContain("Уже подтвердил(а) Игорь");
      expect(get).toHaveBeenCalledTimes(2);
      expect(onChanged).toHaveBeenCalled();
      expect([...el.querySelectorAll("button")].some((b) => (b.textContent ?? "").includes("✅ ОК"))).toBe(false);
    });
  });

  it("«Больничного уже нет» (404): так же — текст, перечитанный список, onChanged", async () => {
    const get = vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([ROW]).mockResolvedValue([]);
    vi.spyOn(apiClient, "rejectSickLeave").mockRejectedValue(new Error("Больничного уже нет"));
    const onChanged = vi.fn();
    const el = await mount({ onChanged });
    await act(async () => { buttonByText(el, "❌ Отклонить").click(); });
    await act(async () => { buttonByText(el, "Да, отклонить").click(); });
    await waitFor(() => {
      expect(el.textContent).toContain("Больничного уже нет");
      expect(get).toHaveBeenCalledTimes(2);
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("два быстрых тапа «ОК» — один запрос", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValue([ROW]);
    const approve = vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue();
    const el = await mount();
    const ok = buttonByText(el, "✅ ОК");
    await act(async () => { ok.click(); ok.click(); });
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    // Второй тап мог дойти позже первого: дать ему шанс, прежде чем утверждать «один».
    await flush();
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it("второй тап после ответа на «ОК», но до перечитывания списка — всё ещё один запрос", async () => {
    // Карточка живёт, пока список не вернулся; кнопки в это окно обязаны быть выключены,
    // иначе второй тап получил бы ложное «Уже подтвердил(а)» от самого себя.
    let releaseReload: (rows: SickApprovalRow[]) => void = () => {};
    vi.spyOn(apiClient, "getSickApprovals")
      .mockResolvedValueOnce([ROW])
      .mockImplementationOnce(() => new Promise((resolve) => { releaseReload = resolve; }));
    const approve = vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue();
    const el = await mount();
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    await flush();
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await flush();
    expect(approve).toHaveBeenCalledTimes(1);
    await act(async () => { releaseReload([]); });
    await waitFor(() => expect(el.textContent).toContain("Больничных на подтверждение нет"));
  });

  it("onChanged зовётся только после перечитывания списка — запросы идут по очереди", async () => {
    const events: string[] = [];
    vi.spyOn(apiClient, "getSickApprovals").mockImplementation(async () => {
      events.push("get");
      return events.length > 1 ? [] : [ROW];
    });
    vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue();
    const el = await mount({ onChanged: () => events.push("changed") });
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await waitFor(() => expect(events).toEqual(["get", "get", "changed"]));
  });

  it("список не загрузился — текст ошибки и «Повторить», который читает заново", async () => {
    const get = vi.spyOn(apiClient, "getSickApprovals").mockRejectedValueOnce(new Error("сеть")).mockResolvedValue([ROW]);
    const el = await mount();
    expect(el.textContent).toContain("сеть");
    await act(async () => { buttonByText(el, "Повторить").click(); });
    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(2);
      expect(el.textContent).toContain("Даша");
    });
  });

  it("решение принято, а перечитать список не вышло — так и сказано, а не «не удалось загрузить»", async () => {
    // Человек нажал «ОК» и видит «Не удалось загрузить больничные»: решил бы, что ОК не прошёл,
    // и нажал бы снова. Сервер уже решил — это надо сказать.
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([ROW]).mockRejectedValue(new Error("сеть"));
    vi.spyOn(apiClient, "approveSickLeave").mockResolvedValue();
    const el = await mount();
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await waitFor(() => {
      expect(el.textContent).toContain("Решение принято, но список не удалось обновить");
      expect(el.textContent).toContain("Повторить");
      expect(el.textContent).not.toContain("сеть");
    });
  });

  it("отказ сервера и провал перечитывания — это не «решение принято»", async () => {
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([ROW]).mockRejectedValue(new Error("сеть"));
    vi.spyOn(apiClient, "approveSickLeave").mockRejectedValue(new Error("Уже подтвердил(а) Игорь"));
    const el = await mount();
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    // Сначала дождаться ответа об отказе (позитивное), потом утверждать «не принято».
    await waitFor(() => expect(el.textContent).toContain("Уже подтвердил(а) Игорь"));
    await flush();
    expect(el.textContent).not.toContain("Решение принято");
  });

  it("отказ сервера прокручивается в видимую часть: список под ним может быть длинным", async () => {
    // Сообщение лежит над списком, а кнопка, которую нажали, — где-то внизу.
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.spyOn(apiClient, "getSickApprovals").mockResolvedValueOnce([ROW]).mockResolvedValue([]);
    vi.spyOn(apiClient, "approveSickLeave").mockRejectedValue(new Error("Уже подтвердил(а) Игорь"));
    const el = await mount();
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => { buttonByText(el, "✅ ОК").click(); });
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    expect((scroll.mock.contexts[0] as HTMLElement).textContent).toContain("Уже подтвердил(а) Игорь");
  });
});

