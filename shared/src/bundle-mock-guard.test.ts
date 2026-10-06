import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Сторож «DEV-мок не уезжает в боевой бандл» живёт в `ops/check-bundle-baseline.mjs`
 * и работает на каждой сборке; здесь проверяется сама функция поиска. Путь —
 * переменной, чтобы `tsc` не тянул `.mjs` в типы воркспейса.
 */
const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../ops/check-bundle-baseline.mjs");
const load = () => import(/* @vite-ignore */ script) as Promise<{ mockLeaks(code: string): string[] }>;

describe("маркеры DEV-мока в собранном JS", () => {
  it("находит строки мока еды, работников и сид команды", async () => {
    const { mockLeaks } = await load();
    expect(mockLeaks('throw Error(`Заказ не найден.`)')).toEqual(["Заказ не найден"]);
    expect(mockLeaks('name:`Шаурма`')).toEqual(["Шаурм"]);
    expect(mockLeaks('displayName:`Аня Смирнова`, `Работник не найден`')).toEqual(["Работник не найден", "Аня Смирнова"]);
  });

  it("чистый код — пусто", async () => {
    const { mockLeaks } = await load();
    expect(mockLeaks("const a = 1; // обычный бандл")).toEqual([]);
  });
});
