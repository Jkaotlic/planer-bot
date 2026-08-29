// Must run before anything else touches the SDK: sets up the mocked
// Telegram bridge (dev only) so the app can run in a plain browser tab.
import "./mockEnv";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { isThemeParamsDark, useSignal } from "@telegram-apps/sdk-react";

import "@telegram-apps/telegram-ui/dist/styles.css";
import "./index.css";

import { App } from "./App";
import { CrashBoundary } from "./components/CrashBoundary";
import { init } from "./init";

init();

function Root() {
  // Reflect the (real or mocked) Telegram theme's light/dark-ness natively,
  // rather than trusting AppRoot's own browser-only auto-detection.
  const isDark = useSignal(isThemeParamsDark);

  return (
    <AppRoot appearance={isDark ? "dark" : "light"}>
      <App />
    </AppRoot>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found");
}

/**
 * Граница снаружи `Root`, а не внутри `App`.
 *
 * `Root` читает сигнал темы из SDK, и если SDK не поднялся, падение случится
 * ещё до `App` — граница внутри `App` его не поймала бы, и человек увидел бы
 * белый экран. Снаружи ловится всё дерево целиком.
 */
createRoot(container).render(
  <StrictMode>
    <CrashBoundary>
      <Root />
    </CrashBoundary>
  </StrictMode>,
);
