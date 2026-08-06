import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { WEEK_SVG_WIDTH } from "./week-svg";

/**
 * SVG → PNG. The only place in the project that knows about the rasterizer.
 *
 * The font is bundled in the repository, and system fonts are deliberately
 * disabled (`loadSystemFonts: false`): otherwise the image would depend on
 * whatever happens to be installed on a given machine, and on ubuntu CI
 * Cyrillic might not render at all — the text would vanish, and nobody
 * would notice.
 */

// This file lives in server/src/render/, so assets are two levels up.
const FONTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");
const FONT_FILES = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map((name) => resolve(FONTS_DIR, name));

export function svgToPng(svg: string, width: number = WEEK_SVG_WIDTH): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: "DejaVu Sans",
    },
  });
  return Buffer.from(resvg.render().asPng());
}
