import { emitEvent, mockTelegramEnv, type ThemeParams } from "@telegram-apps/sdk-react";

/**
 * Dark Telegram theme palette used to mock the native environment.
 * Deliberately distinct from a plain white page so that CSS-variable theming
 * is visibly proven to work when the app is opened in a regular browser tab.
 */
const themeParams: ThemeParams = {
  accent_text_color: "#6ab2f2",
  bg_color: "#17212b",
  button_color: "#5288c1",
  button_text_color: "#ffffff",
  bottom_bar_bg_color: "#17212b",
  destructive_text_color: "#ec3942",
  header_bg_color: "#17212b",
  hint_color: "#708499",
  link_color: "#6ab3f3",
  secondary_bg_color: "#232e3c",
  section_bg_color: "#17212b",
  section_header_text_color: "#6ab3f3",
  section_separator_color: "#111921",
  subtitle_text_color: "#708499",
  text_color: "#f5f5f5",
};

/** A fake authenticated user + init data, raw-encoded the way a real client sends it. */
const initDataRaw = new URLSearchParams([
  [
    "user",
    JSON.stringify({
      id: 1,
      first_name: "Иван",
      last_name: "Иванов",
      username: "ivan_ivanov",
      language_code: "ru",
      is_premium: false,
      allows_write_to_pm: true,
    }),
  ],
  ["hash", "89d6079ad6762351f38c6dbbc41bb53048019256a9443988af7a48bcad16743"],
  ["auth_date", Math.floor(Date.now() / 1000).toString()],
  ["signature", "mocked-signature-not-for-verification"],
  ["start_param", "debug"],
  ["chat_type", "sender"],
  ["chat_instance", "8428209589180549439"],
]);

// Only active in local development: lets the mini app run in a plain browser
// tab (no real Telegram client) by imitating the bridge it talks to.
if (import.meta.env.DEV) {
  mockTelegramEnv({
    launchParams: {
      tgWebAppThemeParams: themeParams,
      tgWebAppData: initDataRaw,
      tgWebAppVersion: "8",
      tgWebAppPlatform: "tdesktop",
      tgWebAppStartParam: "debug",
    },
    onEvent(event, next) {
      // The real Telegram client answers these method calls asynchronously
      // with an event; here we answer them synchronously ourselves so the
      // SDK's mount/request calls resolve instead of hanging.
      if (event[0] === "web_app_request_theme") {
        emitEvent("theme_changed", { theme_params: themeParams });
        return;
      }
      if (event[0] === "web_app_request_viewport") {
        emitEvent("viewport_changed", {
          height: window.innerHeight,
          width: window.innerWidth,
          is_expanded: true,
          is_state_stable: true,
        });
        return;
      }
      next();
    },
  });
}
