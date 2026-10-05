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

describe("qrcode — только в ленивом куске", () => {
  it("@planer/shared/qr импортирует один QrScreen", () => {
    const importers = sources(src)
      .filter((file) => readFileSync(file, "utf8").includes("@planer/shared/qr"))
      .map((file) => relative(src, file));
    expect(importers).toEqual(["screens/services/QrScreen.tsx"]);
  });

  it("App подключает QrScreen через lazy, а не статическим импортом", () => {
    const app = readFileSync(join(src, "App.tsx"), "utf8");
    expect(app).toMatch(/lazy\(\(\) => import\("\.\/screens\/services\/QrScreen"\)/);
    expect(app).not.toMatch(/from "\.\/screens\/services\/QrScreen"/);
  });
});
