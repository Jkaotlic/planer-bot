import { DEFAULT_QR_STYLE, QR_MAX_TEXT_LENGTH, type QrSavedStyle, type QrStyle } from "@planer/shared";
import { QrTextError, renderQr } from "@planer/shared/qr";
import { svgToPng } from "../render/rasterize";

/**
 * QR code for a link: text -> SVG (`renderQr` from shared, the same one the mini app
 * draws with) -> PNG through the same rasteriser that draws the week. One rasteriser
 * for the whole bot is simpler than two.
 */
export type QrImage =
  | { kind: "photo"; png: Buffer; caption: string }
  | { kind: "text"; text: string };

// The limit moved to shared with the renderer; re-exported so older tests keep their import.
export { QR_MAX_TEXT_LENGTH };

/**
 * The PNG people receive — from the bot and from «Прислать мне в бота» alike. Rasterised
 * at exactly the width `renderQr` asks for: integer pixels per module are what keep the
 * densest codes decodable (see `server/src/render/qr-readability.test.ts`).
 * Throws `QrTextError` with a message meant for the person.
 */
export function renderQrPng(text: string, style: QrStyle): Buffer {
  const { svg, width } = renderQr(text, style);
  return svgToPng(svg, width);
}

/**
 * The bot's answer to a link. The style is the sender's last pick in the mini app; the
 * Telegram caption stays the link itself, so it is tappable in the chat.
 */
export async function buildQrImage(url: string, style: QrSavedStyle = DEFAULT_QR_STYLE): Promise<QrImage> {
  if (url.length > QR_MAX_TEXT_LENGTH) {
    return { kind: "text", text: `Слишком длинная ссылка для QR-кода: ${url.length} знаков, а помещается ${QR_MAX_TEXT_LENGTH}.` };
  }
  try {
    return { kind: "photo", png: renderQrPng(url, style), caption: url };
  } catch (err) {
    if (err instanceof QrTextError) return { kind: "text", text: classicWouldFit(url, style) ? FORM_ADVICE : err.message };
    throw err;
  }
}

/**
 * In the chat the sender cannot pick a style, and the shared error text only says
 * "choose Классика" without saying where. The advice is given only when it is true:
 * a fancy form is what stopped the code, and the classic one would draw it.
 */
const FORM_ADVICE =
  "Эта ссылка не помещается в QR-код выбранной формы: у фигурных форм запас на ошибки больше, а места меньше. " +
  "Чтобы получить код, выбери «Классику» в мини-аппе: 🧰 Сервисы → QR-код — она вмещает больше.";

function classicWouldFit(url: string, style: QrSavedStyle): boolean {
  if (style.shape === "classic") return false;
  try {
    renderQr(url, { ...style, shape: "classic" });
    return true;
  } catch {
    return false;
  }
}
