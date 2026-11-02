// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signals = { mounted: false, tgDark: true };

vi.mock("@telegram-apps/sdk-react", () => ({
  isThemeParamsMounted: () => signals.mounted,
  isThemeParamsDark: () => signals.tgDark,
  useSignal: (signal: () => boolean) => signal(),
}));

async function readIsDark(): Promise<boolean> {
  const { useIsDark } = await import("./theme");
  let seen = false;
  function Probe() {
    seen = useIsDark();
    return null;
  }
  await act(async () => createRoot(document.createElement("div")).render(createElement(Probe)));
  return seen;
}

describe("useIsDark", () => {
  it("без смонтированной темы — светлая, даже если SDK отвечает «тёмная»", async () => {
    signals.mounted = false;
    signals.tgDark = true;
    expect(await readIsDark()).toBe(false);
  });

  it("с темой верит клиенту: тёмная", async () => {
    signals.mounted = true;
    signals.tgDark = true;
    expect(await readIsDark()).toBe(true);
  });

  it("с темой верит клиенту: светлая", async () => {
    signals.mounted = true;
    signals.tgDark = false;
    expect(await readIsDark()).toBe(false);
  });
});
