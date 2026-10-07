// Must run before anything else touches the SDK: sets up the mocked
// Telegram bridge (dev only) so the app can run in a plain browser tab.
import "./mockEnv";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import { App } from "./App";
import { CrashBoundary } from "./components/CrashBoundary";
import { init } from "./init";

init();

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found");
}

// Граница снаружи `App`: упавший экран оставляет на месте белой страницы объяснение
// и кнопку «Обновить страницу», а не пустоту, неотличимую от «консоль не открылась».
createRoot(container).render(
  <StrictMode>
    <CrashBoundary>
      <App />
    </CrashBoundary>
  </StrictMode>,
);
