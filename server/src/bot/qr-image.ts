import { DEFAULT_QR_STYLE, QR_MAX_TEXT_LENGTH, type QrSavedStyle, type QrStyle } from "@planer/shared";
import { QrTextError, renderQr } from "@planer/shared/qr";
import { svgToPng } from "../render/rasterize";

/**
 * QR-код по ссылке: текст → SVG → PNG тем же растеризатором, что рисует неделю.
 *
 * `qrcode` умеет отдавать PNG и сам, но через свой `pngjs`; один растеризатор
 * на весь бот проще, чем два, и шрифты здесь не нужны — только квадраты.
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
    if (err instanceof QrTextError) return { kind: "text", text: err.message };
    throw err;
  }
}
