// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { SelfEntryScreen } from "./SelfEntryScreen";

/**
 * Подпись «Админам уйдёт письмо» обещает ОК, а больничный админа подтверждается сразу
 * (сервер: `needsOk` только для не-админа). Обещание, которое для него ложно, не показываем.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(isAdmin: boolean | undefined) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(
        AppRoot,
        null,
        createElement(SelfEntryScreen, {
          mode: "sick" as const, today: "2026-10-05", shifts: [], templates: [], ownShifts: false,
          ...(isAdmin === undefined ? {} : { isAdmin }),
          onCancel: vi.fn(), onCreate: vi.fn(async () => []), onUpdate: vi.fn(async () => {}), onDelete: vi.fn(async () => {}),
          onOfferHandover: vi.fn(async () => {}), onSkipHandover: vi.fn(async () => {}),
        }),
      ),
    );
  });
  return host!;
}

describe("подпись формы больничного", () => {
  it("работнику обещает письмо админам", async () => {
    const el = await render(false);
    expect(el.textContent).toContain("Админам уйдёт письмо");
  });

  it("по умолчанию (роль не передана) — как работнику: сервер тоже считает неадмина работником", async () => {
    const el = await render(undefined);
    expect(el.textContent).toContain("Админам уйдёт письмо");
  });

  it("админу не показывается: его больничный подтверждён сразу", async () => {
    const el = await render(true);
    // Форма на месте (иначе «нет подписи» прошло бы и на пустом экране).
    expect(el.textContent).toContain("Когда болеешь");
    expect(el.textContent).not.toContain("Админам уйдёт письмо");
  });
});
