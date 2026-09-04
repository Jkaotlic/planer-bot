import { describe, it, expect } from "vitest";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { buildQrImage, QR_MAX_TEXT_LENGTH } from "./qr-image";

/**
 * Картинка проверяется декодером, а не по сигнатуре PNG: любой PNG прошёл бы
 * проверку сигнатуры, и тест был бы зелёным на реализации, рисующей квадрат.
 */
function decode(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
}

describe("QR-код по ссылке", () => {
  it("рисует PNG, из которого сканер читает ту же ссылку", async () => {
    const res = await buildQrImage("https://example.com/sbor?x=1");

    expect(res.kind).toBe("photo");
    if (res.kind !== "photo") throw new Error("ожидалась картинка");
    expect(res.caption).toBe("https://example.com/sbor?x=1");
    expect(decode(res.png)).toBe("https://example.com/sbor?x=1");
  });

  it("не рисует слишком длинную ссылку, а объясняет словами", async () => {
    const res = await buildQrImage(`https://example.com/${"a".repeat(QR_MAX_TEXT_LENGTH)}`);

    expect(res.kind).toBe("text");
    if (res.kind !== "text") throw new Error("ожидался текст");
    expect(res.text).toContain("длинн");
  });

  it("ссылку ровно в лимит ещё рисует", async () => {
    const url = `https://example.com/${"a".repeat(QR_MAX_TEXT_LENGTH - "https://example.com/".length)}`;
    expect(url).toHaveLength(QR_MAX_TEXT_LENGTH);

    const res = await buildQrImage(url);

    expect(res.kind).toBe("photo");
    if (res.kind !== "photo") throw new Error("ожидалась картинка");
    expect(decode(res.png)).toBe(url);
  });
});
