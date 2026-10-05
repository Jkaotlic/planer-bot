import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import QRCode from "qrcode";
import { QR_COLOR_KEYS, QR_SHAPES, type QrStyle } from "@planer/shared";
import { QR_QUIET_ZONE, renderQr } from "@planer/shared/qr";
import { svgToPng } from "./rasterize";

/**
 * Readability is proven by a scanner, not by eye: every shape × colour × length goes
 * through the exact pipeline people receive (SVG → PNG at `renderQr`'s width → jsQR).
 *
 * The dark surround is Telegram's dark theme around a forwarded picture. Without the
 * quiet zone the finder patterns merge with it and nothing decodes — measured while
 * planning; the plain-white case alone decodes even with no quiet zone at all, so it
 * cannot guard that.
 */
const SHORT = "https://example.com/menu";
const LONG = `https://example.com/sbor?ref=${"a1B2c3".repeat(200)}`.slice(0, 1000);
const CYRILLIC = "Сбор на кофемашину — скидываемся до пятницы";

function picture(text: string, style: QrStyle): Buffer {
  const { svg, width } = renderQr(text, style);
  return svgToPng(svg, width);
}

function decode(image: PNG): string | null {
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
}

function onDark(png: Buffer): PNG {
  const src = PNG.sync.read(png);
  const pad = 48;
  const out = new PNG({ width: src.width + 2 * pad, height: src.height + 2 * pad });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 0x18;
    out.data[i + 1] = 0x22;
    out.data[i + 2] = 0x2d;
    out.data[i + 3] = 255;
  }
  PNG.bitblt(src, out, 0, 0, src.width, src.height, pad, pad);
  return out;
}

describe.each(QR_SHAPES)("QR «%s» читается сканером", (shape) => {
  it.each(QR_COLOR_KEYS)("цвет %s: короткая, длинная (1000) и кириллица — на белом и на тёмной подложке", (color) => {
    for (const text of [SHORT, LONG, CYRILLIC]) {
      const png = picture(text, { shape, color });
      expect(decode(PNG.sync.read(png)), `${shape}/${color}/${text.length}`).toBe(text);
      expect(decode(onDark(png)), `${shape}/${color}/${text.length} на тёмном`).toBe(text);
    }
  });

  it("с подписью из спецсимволов читается и растеризуется", () => {
    const png = picture(SHORT, { shape, color: "burgundy", caption: `Сбор <на> & "кофе"` });
    expect(decode(onDark(png))).toBe(SHORT);
  });
});

describe("самые плотные коды на отдаваемой ширине", () => {
  // On a fixed 768 or 1024 these did not decode while planning; integer pixels per module fixed it.
  it.each([
    ["classic", "Ж".repeat(1000)],
    ["soft", "Ж".repeat(600)],
    ["dots", "Ж".repeat(600)],
    ["rounded", `https://example.com/${"путь/".repeat(150)}`.slice(0, 1000)],
  ] as const)("%s, %#", (shape, text) => {
    expect(decode(PNG.sync.read(picture(text, { shape, color: "black" })))).toBe(text);
  });
});

describe("тихая зона", () => {
  it("вокруг кода белая рамка не уже 4 модулей", () => {
    const image = PNG.sync.read(picture(SHORT, { shape: "classic", color: "black" }));
    const across = QRCode.create(SHORT, { errorCorrectionLevel: "M" }).modules.size + 2 * QR_QUIET_ZONE;
    const pxPerModule = image.width / across;
    let nearest = Number.POSITIVE_INFINITY;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (image.data[(y * image.width + x) * 4]! < 128) {
          nearest = Math.min(nearest, x, y, image.width - 1 - x, image.height - 1 - y);
        }
      }
    }
    expect(nearest).toBeGreaterThanOrEqual(Math.floor(4 * pxPerModule) - 1);
  });
});

describe("caption stays inside the picture", () => {
  // Wide capitals run ~0.9-1 em in DejaVu Sans; a caption sized for average glyphs
  // overflowed the viewBox and was clipped at both edges.
  it.each(["Ж", "Ш", "W"])("40 × %s leaves the side margins white and the code readable", (glyph) => {
    const text = SHORT;
    const image = PNG.sync.read(picture(text, { shape: "classic", color: "black", caption: glyph.repeat(40) }));
    const margin = 4;
    for (let y = 0; y < image.height; y += 1) {
      for (const x of Array.from({ length: margin }, (_, i) => i).flatMap((i) => [i, image.width - 1 - i])) {
        expect(image.data[(y * image.width + x) * 4]!, `ink at x=${x}, y=${y}`).toBeGreaterThan(200);
      }
    }
    expect(decode(PNG.sync.read(picture(text, { shape: "classic", color: "black", caption: glyph.repeat(40) })))).toBe(text);
  });

  it("a lone surrogate and U+FFFF in the caption do not make the rasterizer reject the SVG", () => {
    const png = picture(SHORT, { shape: "dots", color: "blue", caption: "a\uD800b\uDC00c\uFFFFd\uFFFEe" });
    expect(decode(PNG.sync.read(png))).toBe(SHORT);
  });
});
