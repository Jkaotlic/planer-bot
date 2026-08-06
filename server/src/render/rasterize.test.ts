import { describe, it, expect } from "vitest";
import { svgToPng } from "./rasterize";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200" font-family="DejaVu Sans">`
  + `<rect width="400" height="200" fill="#FFFFFF"/>`
  + `<text x="20" y="60" font-size="24" fill="#17202A">Иванов Иван</text>`
  + `</svg>`;

describe("svgToPng", () => {
  it("отдаёт настоящий PNG заданной ширины", () => {
    const png = svgToPng(SVG, 800);
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // Width lives in IHDR, big-endian, starting at byte 16.
    expect(png.readUInt32BE(16)).toBe(800);
    expect(png.length).toBeGreaterThan(1000);
  });

  it("рисует кириллицу из приложенного шрифта, а не из системного", () => {
    // If the font didn't load, resvg silently skips the text: the PNG stays
    // nearly empty and compresses down to a tiny size. Compare against a
    // canvas without text — with the letters, the file must be noticeably
    // heavier.
    const withoutText = svgToPng(SVG.replace(/<text[\s\S]*?<\/text>/, ""), 800);
    expect(svgToPng(SVG, 800).length).toBeGreaterThan(withoutText.length + 500);
  });
});
