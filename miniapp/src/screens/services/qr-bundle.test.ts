import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `qrcode` — в ленивом куске экрана «QR-код», а не в основном бандле: мини-апп
 * открывают через релей 11–58 КБ/с, и каждый килобайт старта платят все.
 * Импорт `@planer/shared/qr` вне `QrScreen` или статический импорт экрана в
 * `App.tsx` молча вернул бы библиотеку в основной бандл — сборка этого не заметит.
 */
const src = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const qrScreenPath = join(src, "screens/services/QrScreen");

/** Статические (не `import(...)`) указатели модулей: `import … from`, `export … from`, `import "x"`. */
export function staticSpecifiers(code: string): string[] {
  const out: string[] = [];
  const re = /\b(?:import|export)\s+(?:type\s+)?(?:[^;'"`]*?\sfrom\s*)?(["'])([^"'\n]+)\1/g;
  for (const m of code.matchAll(re)) out.push(m[2]!);
  return out;
}

/** Указатель ведёт в модуль экрана, как бы он ни был записан: кавычки, расширение, путь. */
function pointsAtQrScreen(file: string, specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const target = resolve(dirname(file), specifier).replace(/\.tsx?$/, "");
  return target === qrScreenPath;
}

describe("детектор статических импортов", () => {
  it("видит любые кавычки и расширения, не принимает динамический import()", () => {
    expect(staticSpecifiers(`import { QrScreen } from './QrScreen.tsx';`)).toEqual(["./QrScreen.tsx"]);
    expect(staticSpecifiers(`import {\n  A,\n} from "../x";\nexport * from "./y";\nimport "./z";`)).toEqual(["../x", "./y", "./z"]);
    expect(staticSpecifiers(`const L = lazy(() => import("./screens/services/QrScreen"));`)).toEqual([]);
  });
  it("сопоставляет путь с модулем экрана", () => {
    expect(pointsAtQrScreen(join(src, "screens/services/ServicesScreen.tsx"), "./QrScreen")).toBe(true);
    expect(pointsAtQrScreen(join(src, "App.tsx"), "./screens/services/QrScreen.tsx")).toBe(true);
    expect(pointsAtQrScreen(join(src, "App.tsx"), "./screens/services/ServicesScreen")).toBe(false);
  });
});

describe("qrcode — только в ленивом куске", () => {
  it("@planer/shared/qr импортирует один QrScreen", () => {
    const importers = sources(src)
      .filter((file) => readFileSync(file, "utf8").includes("@planer/shared/qr"))
      .map((file) => relative(src, file));
    expect(importers).toEqual(["screens/services/QrScreen.tsx"]);
  });

  it("экран подключается только через import(): статических ссылок на него нет нигде", () => {
    const offenders = sources(src).filter((file) =>
      staticSpecifiers(readFileSync(file, "utf8")).some((spec) => pointsAtQrScreen(file, spec)),
    );
    expect(offenders.map((f) => relative(src, f))).toEqual([]);
  });

  it("App подключает QrScreen через lazy", () => {
    const app = readFileSync(join(src, "App.tsx"), "utf8");
    expect(app).toMatch(/lazy\(\(\) => import\("\.\/screens\/services\/QrScreen"\)/);
  });

  it("самого `qrcode` в исходниках мини-аппа нет: он приезжает только через shared/qr", () => {
    const offenders = sources(src).filter((file) => staticSpecifiers(readFileSync(file, "utf8")).some((s) => s === "qrcode" || s.startsWith("qrcode/")));
    expect(offenders).toEqual([]);
  });
});
