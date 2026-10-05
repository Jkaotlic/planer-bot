import QRCode from "qrcode";
import type { QrStyle } from "@planer/shared";
import { renderQr } from "@planer/shared/qr";
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

/**
 * Длиннее — и QR становится решёткой, которую телефон с расстояния уже не
 * читает; версия 40 вмещает ~2900 знаков, но такой код надо печатать на A4.
 */
export const QR_MAX_TEXT_LENGTH = 1000;

/**
 * Telegram сжимает фото в JPEG: на маленькой картинке артефакты съедают
 * модули, на этой — нет, она читается и с экрана, и с распечатки.
 */
const QR_PNG_WIDTH = 768;

export async function buildQrImage(url: string): Promise<QrImage> {
  if (url.length > QR_MAX_TEXT_LENGTH) {
    return { kind: "text", text: `Слишком длинная ссылка для QR-кода: ${url.length} знаков, а помещается ${QR_MAX_TEXT_LENGTH}.` };
  }
  const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  return { kind: "photo", png: svgToPng(svg, QR_PNG_WIDTH), caption: url };
}

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
