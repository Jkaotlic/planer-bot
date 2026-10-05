import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { QR_MAX_TEXT_LENGTH, QR_RASTER_WIDTH, QR_SHAPES } from "./style";
import { QR_QUIET_ZONE, QrTextError, qrPreview, renderQr, renderQrSvg } from "./render";

const SHORT = "https://example.com/menu";

/** Модулей поперёк — из viewBox: единица SVG — 10 на модуль. */
function modulesAcross(svg: string): number {
  return Number(/viewBox="0 0 (\d+) /.exec(svg)![1]) / 10;
}

function textError(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(QrTextError);
    return (err as Error).message;
  }
  throw new Error("ожидалась QrTextError");
}

describe("renderQr — ошибки словами для человека", () => {
  it("пустой текст", () => {
    expect(textError(() => renderQr("   ", { shape: "classic", color: "black" }))).toContain("Впиши");
  });

  it(`длиннее ${QR_MAX_TEXT_LENGTH} знаков не рисует и называет предел`, () => {
    const msg = textError(() => renderQr("a".repeat(QR_MAX_TEXT_LENGTH + 1), { shape: "classic", color: "black" }));
    expect(msg).toContain(String(QR_MAX_TEXT_LENGTH));
  });

  it("ровно в предел ещё рисует", () => {
    expect(renderQrSvg("a".repeat(QR_MAX_TEXT_LENGTH), { shape: "dots", color: "black" })).toContain("<svg");
  });

  // Кириллица весит вдвое: 1000 знаков = 2000 байт, уровень Q вмещает 1663.
  it("длинная кириллица, не влезшая в фигурный код, — совет выбрать «Классику», а «Классика» её рисует", () => {
    const text = "Ж".repeat(QR_MAX_TEXT_LENGTH);
    expect(textError(() => renderQr(text, { shape: "dots", color: "black" }))).toContain("«Классику»");
    expect(renderQrSvg(text, { shape: "classic", color: "black" })).toContain("<svg");
  });

  it("подпись длиннее 40 знаков", () => {
    expect(textError(() => renderQr(SHORT, { shape: "classic", color: "black", caption: "Ж".repeat(41) }))).toContain("40");
  });
});

describe("renderQr — подпись", () => {
  it("экранирует разметку: подпись видна как набрана, а не разбирается как XML", () => {
    const svg = renderQrSvg(SHORT, { shape: "classic", color: "black", caption: `<b>Сбор & "кофе" 'да'</b>` });
    expect(svg).toContain("&lt;b&gt;Сбор &amp; &quot;кофе&quot; &apos;да&apos;&lt;/b&gt;");
    expect(svg).not.toContain("<b>");
  });

  it("вырезает управляющие символы и сводит переводы строк в пробел", () => {
    const svg = renderQrSvg(SHORT, { shape: "classic", color: "black", caption: "Сбор\u0007\nна кофе" });
    expect(svg).toContain(">Сбор на кофе</text>");
    expect(svg).not.toContain("\u0007");
  });

  it("подпись делает картинку выше, но не шире", () => {
    const plain = renderQr(SHORT, { shape: "soft", color: "blue" });
    const signed = renderQr(SHORT, { shape: "soft", color: "blue", caption: "Сбор на кофемашину" });
    expect(signed.width).toBe(plain.width);
    expect(signed.height).toBeGreaterThan(plain.height);
  });

  it("пустая подпись — подписи нет", () => {
    expect(renderQrSvg(SHORT, { shape: "classic", color: "black", caption: "   " })).not.toContain("<text");
  });
});

describe("renderQr — геометрия", () => {
  it("красит выбранным цветом", () => {
    const svg = renderQrSvg(SHORT, { shape: "dots", color: "blue" });
    expect(svg).toContain('fill="#0B3D91"');
    expect(svg).not.toContain("#111111");
  });

  it("«Классика» на уровне M, фигурные — на Q; тихая зона — 4 модуля с каждой стороны", () => {
    const m = QRCode.create(SHORT, { errorCorrectionLevel: "M" }).modules.size;
    const q = QRCode.create(SHORT, { errorCorrectionLevel: "Q" }).modules.size;
    expect(modulesAcross(renderQrSvg(SHORT, { shape: "classic", color: "black" }))).toBe(m + 2 * QR_QUIET_ZONE);
    for (const shape of QR_SHAPES.filter((s) => s !== "classic")) {
      expect(modulesAcross(renderQrSvg(SHORT, { shape, color: "black" }))).toBe(q + 2 * QR_QUIET_ZONE);
    }
    expect(QR_QUIET_ZONE).toBe(4);
  });

  it("ширина — целое число пикселей на модуль и не меньше QR_RASTER_WIDTH", () => {
    for (const text of [SHORT, "a".repeat(QR_MAX_TEXT_LENGTH)]) {
      const { svg, width } = renderQr(text, { shape: "rounded", color: "black" });
      expect(width % modulesAcross(svg)).toBe(0);
      expect(width).toBeGreaterThanOrEqual(QR_RASTER_WIDTH);
      expect(width - modulesAcross(svg)).toBeLessThan(QR_RASTER_WIDTH);
    }
  });
});

describe("qrPreview", () => {
  it("пусто — подсказка, ошибка — её текст, иначе картинка data-URL", () => {
    expect(qrPreview("", { shape: "classic", color: "black" })).toEqual({ kind: "empty" });
    expect(qrPreview("a".repeat(1001), { shape: "classic", color: "black" })).toMatchObject({ kind: "error" });
    const ok = qrPreview(SHORT, { shape: "classic", color: "black" });
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") expect(ok.src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
  });
});
