// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type AdminSettings as AdminSettingsData, } from "../../api/client";
import { AdminSettings } from "./AdminSettings";

/**
 * «Настройки» (мини-апп) — один тумблер, который пишет всей команде разом.
 *
 * Зеркало `admin/src/screens/settings.test.tsx`: те же семь тестов, тот же
 * повод для каждого. Подтверждение второго нажатия — потому что это
 * единственное действие в консоли, после которого 26 человек получают
 * сообщение, и отменить его нельзя. Ошибка рядом с тумблером, а не вместо
 * него — потому что из состояния «на экране только текст ошибки» нет выхода
 * без перезагрузки; этот класс дефекта в проекте уже ловили дважды.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPEN = { swapsLocked: false, swapsLockUpdatedAt: "2026-08-07T11:30:00.000Z", swapsLockUpdatedBy: "Игорь Петров" };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

/** Мок отвечает через setTimeout — крутим таймеры, пока экран не догрузится. */
async function settle(times = 14) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    // telegram-ui требует свой провайдер; проверяем мы то, что внутри.
    root!.render(createElement(AppRoot, null, createElement(AdminSettings)));
  });
  await settle();
  return host;
}

/** Кнопка по её подписи — так же, как её ищет глазами человек. */
function buttonWith(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`нет кнопки с текстом «${text}»`);
  return found as HTMLButtonElement;
}

describe("AdminSettings", () => {
  it("показывает состояние обменов и кто его менял", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    const el = await mount();
    expect(el.textContent ?? "").toContain("Открыты");
    expect(el.textContent ?? "").toContain("Игорь Петров");
  });

  it("первое нажатие не отправляет запрос, а спрашивает подтверждение", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    const setLock = vi.spyOn(apiClient, "setSwapsLock");
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();

    expect(setLock).not.toHaveBeenCalled();
    expect(el.textContent ?? "").toContain("Да, закрыть");
  });

  it("подтверждение закрывает обмены и называет цену", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    const setLock = vi.spyOn(apiClient, "setSwapsLock")
      .mockResolvedValue({ locked: true, cancelled: 2, delivered: 24, intended: 26 });
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    await act(async () => buttonWith(el, "Да, закрыть").click());
    await settle();

    expect(setLock).toHaveBeenCalledTimes(1);
    expect(setLock).toHaveBeenCalledWith(true);
    const shown = el.textContent ?? "";
    expect(shown).toContain("2");   // отменённые заявки
    expect(shown).toContain("24");  // дошло
    expect(shown).toContain("26");  // из скольких
  });

  it("ошибка сохранения показывается рядом с тумблером, а не вместо него", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    vi.spyOn(apiClient, "setSwapsLock").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    await act(async () => buttonWith(el, "Да, закрыть").click());
    await settle();

    expect(el.textContent ?? "").toContain("сеть недоступна");
    // Тумблер обязан остаться на экране: иначе из этого состояния нет выхода без F5.
    expect(buttonWith(el, "Закрыть обмены")).toBeTruthy();
  });

  /**
   * Окно между «сервер ответил» и «экран перечитан».
   *
   * `confirming` сбрасывается сразу после ответа `setSwapsLock`, а `saving` —
   * только в `finally`, после `reload()`. Между ними экран рисует состояние
   * `confirming=false, saving=true`: подтверждения на экране уже нет, а ОСНОВНАЯ
   * кнопка снова видна. Если она не погашена — второе нажатие уходит вторым
   * сообщением всей команде.
   *
   * Поэтому тест держит незавершённым именно `reload()` (второй `getSettings`),
   * а не `setSwapsLock`, и щупает ОСНОВНУЮ кнопку. Проверка кнопки
   * подтверждения тут ничего не стоит: у неё `disabled` был и до починки, и до
   * этого окна экран всё равно не доходит.
   *
   * Подпись основной кнопки в этом окне ещё старая («Закрыть обмены»): она
   * считается от `settings.swapsLocked`, а `settings` обновится только после
   * перечитывания.
   */
  it("в окне между ответом и перечитыванием основная кнопка погашена", async () => {
    let releaseReload!: (value: AdminSettingsData) => void;
    vi.spyOn(apiClient, "getSettings")
      .mockResolvedValueOnce(OPEN)
      .mockReturnValueOnce(new Promise((resolve) => { releaseReload = resolve; }));
    vi.spyOn(apiClient, "setSwapsLock")
      .mockResolvedValue({ locked: true, cancelled: 0, delivered: 1, intended: 1 });
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    await act(async () => buttonWith(el, "Да, закрыть").click());
    await settle();

    expect(buttonWith(el, "Закрыть обмены").disabled).toBe(true);

    await act(async () => releaseReload({ ...OPEN, swapsLocked: true }));
    await settle();
  });

  it("взведение убирает ошибку прошлой попытки", async () => {
    vi.spyOn(apiClient, "getSettings").mockResolvedValue(OPEN);
    vi.spyOn(apiClient, "setSwapsLock").mockRejectedValue(new Error("сеть недоступна"));
    const el = await mount();

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    await act(async () => buttonWith(el, "Да, закрыть").click());
    await settle();
    expect(el.textContent ?? "").toContain("сеть недоступна");

    await act(async () => buttonWith(el, "Закрыть обмены").click());
    await settle();
    // Старый отказ рядом с новым подтверждением читается как отказ на него.
    expect(el.textContent ?? "").not.toContain("сеть недоступна");
  });

  it("если тумблер ни разу не трогали, так и написано", async () => {
    vi.spyOn(apiClient, "getSettings")
      .mockResolvedValue({ swapsLocked: false, swapsLockUpdatedAt: null, swapsLockUpdatedBy: null });
    const el = await mount();
    expect(el.textContent ?? "").toContain("Ни разу не меняли");
  });

  // «Ни разу не меняли» отвечает на другой вопрос, чем «кто менял»: сервер
  // отдаёт `swapsLockUpdatedBy: null`, когда актор не резолвится (уволен,
  // запись удалена), но время смены при этом настоящее. Если экран судит по
  // имени, а не по времени, он врёт о том, что тумблер вообще не трогали.
  it("время есть, а имя не резолвится — экран не говорит «ни разу не меняли»", async () => {
    vi.spyOn(apiClient, "getSettings")
      .mockResolvedValue({ swapsLocked: true, swapsLockUpdatedAt: "2026-08-07T11:30:00.000Z", swapsLockUpdatedBy: null });
    const el = await mount();
    const text = el.textContent ?? "";
    expect(text).not.toContain("Ни разу не меняли");
    expect(text).toContain("7 августа");
  });
});
