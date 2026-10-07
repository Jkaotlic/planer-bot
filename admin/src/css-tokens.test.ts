/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Vitest подменяет импорт .css пустой строкой, поэтому читаем файл напрямую.
const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

// Таблица стилей читается как текст: проверяем не вид, а то, что числа в ней не
// расползлись обратно. До токенов в файле жили 15 кеглей и 11 радиусов.

describe("токены оформления консоли", () => {
  it("токены объявлены со значениями из спеки", () => {
    for (const decl of [
      "--text-title: 20px", "--text-head: 15px", "--text-body: 14px", "--text-sub: 13px", "--text-meta: 12px",
      "--radius-card: 12px", "--radius-control: 8px", "--radius-pill: 999px",
      "--control-h: 36px", "--control-h-compact: 30px", "--page-max: 1180px", "--form-max: 720px",
    ]) expect(css).toContain(decl);
  });

  it("кегли числом остались только у двух оговорённых исключений", () => {
    // Чего эта проверка намеренно НЕ видит: сокращённую запись `font: 12px/1.4 …`
    // и размеры в `rem`/`em` — в файле их нет, а ловить их регуляркой на
    // каждый возможный вид записи дороже, чем заметить на ревью.
    const literal = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => m[1]);
    // 10.5 и 9.5 — мелкая подпись клетки сетки и таблицы журнала; токена под неё нет намеренно.
    expect([...new Set(literal)].sort()).toEqual(["10.5", "9.5"]);
  });

  it("радиусы числом — только полоски в 2px и круг", () => {
    // Берём и сокращённую запись, и угловые `border-top-left-radius` и т. п.
    const literal = [...css.matchAll(/(?:^|[\s;{])(border(?:-[a-z]+)*-radius):\s*([^;}]+)[;}]/g)]
      .map((m) => m[2].trim());
    // Каждая часть значения — токен, calc от токена, ноль или оговорённый литерал.
    // Раньше хватало `includes("var(")`, и `14px var(--x)` проходило.
    const allowed = (part: string) =>
      /^var\(--[a-z-]+\)$/.test(part) || /^calc\(var\(--[a-z-]+\)[^()]*\)$/.test(part) || part === "0" || part === "2px" || part === "50%";
    const parts = (v: string) => v.match(/calc\([^)]*\([^)]*\)[^)]*\)|\S+/g) ?? [];
    const bad = literal.filter((v) => !parts(v).every(allowed));
    expect(bad).toEqual([]);
    expect(literal.length).toBeGreaterThan(20);
  });

  it("перед каждым color-mix стоит простое значение того же свойства — или смесь под @supports", () => {
    const lines = css.split("\n");
    // Строки внутри `@supports (… color-mix …) { … }`: там запасное значение стоит в
    // правиле снаружи блока. Так надёжнее второй строки подряд — её сборщик консоли
    // склеивал с первой и выбрасывал запасную (замер dist 2026-10-06).
    const guarded = new Set<number>();
    lines.forEach((line, start) => {
      if (!/^@supports[^{]*color-mix/.test(line)) return;
      let depth = 0;
      for (let i = start; i < lines.length; i += 1) {
        depth += (lines[i]!.match(/\{/g) ?? []).length - (lines[i]!.match(/\}/g) ?? []).length;
        guarded.add(i);
        if (depth === 0 && i > start) break;
      }
    });
    lines.forEach((line, i) => {
      const m = line.match(/^\s*([a-z-]+):\s*color-mix\(/);
      if (!m || guarded.has(i)) return;
      expect(lines[i - 1]?.trim().startsWith(`${m[1]}:`), `строка ${i + 1}: ${line.trim()}`).toBe(true);
    });
  });
  // Контраст двух цветов светлой палитры; WCAG: 4.5 для мелкого текста.
  const lightContrast = (fg: string, bg: string) => {
    const start = css.indexOf(":root {");
    const root = css.slice(start, css.indexOf("}", start));
    const hex = (name: string) => root.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`))![1];
    const lum = (h: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [a, b] = [lum(hex(fg)), lum(hex(bg))].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  };

  it("серый текст на карточке читается: контраст светлой палитры не ниже 4.5", () => {
    expect(lightContrast("fallback-hint", "fallback-section-bg")).toBeGreaterThanOrEqual(4.5);
  });

  it("ссылка и тихая кнопка на карточке читаются: контраст светлой палитры не ниже 4.5", () => {
    expect(lightContrast("fallback-link", "fallback-section-bg")).toBeGreaterThanOrEqual(4.5);
  });

  // Вторичный фон (#e4e3ea) — подложка наведения тихой кнопки и серых плашек: на нём прежние
  // #1767bd (4.44) и #666b77 (4.19) не дотягивали до порога, хотя на карточке и холсте проходили.
  it("серый текст и тихая кнопка при наведении читаются на вторичном фоне: не ниже 4.5", () => {
    expect(lightContrast("fallback-hint", "fallback-secondary-bg")).toBeGreaterThanOrEqual(4.5);
    expect(lightContrast("fallback-link", "fallback-secondary-bg")).toBeGreaterThanOrEqual(4.5);
  });

  it("серый текст и ссылка читаются на холсте страницы: не ниже 4.5", () => {
    expect(lightContrast("fallback-hint", "fallback-bg")).toBeGreaterThanOrEqual(4.5);
    expect(lightContrast("fallback-link", "fallback-bg")).toBeGreaterThanOrEqual(4.5);
  });

  it("белый текст на залитой синей кнопке читается: контраст светлой палитры не ниже 4.5", () => {
    expect(lightContrast("fallback-button-text", "fallback-button")).toBeGreaterThanOrEqual(4.5);
  });

  it("невыбранный пункт переключателя не серый --hint", () => {
    const rule = css.match(/\n\.segmented-item \{([^}]*)\}/)![1];
    expect(rule).not.toMatch(/color:\s*var\(--hint\)/);
  });

  // Ловушка каскада: каждый :not() в селекторе прибавляет вес. Цепочка `input:not(…):not(…)…`
  // давала 0,6,1 и перебивала частные классовые правила (`.employee-position`, ширина 44px),
  // которые раньше выигрывали у общего правила 0,1,1. Общее правило высоты полей обязано
  // оставаться слабее любого классового.
  it("общее правило высоты полей без :not() — не перебивает классовые правила", () => {
    const m = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/([^{}]*input\[type="number"\][^{}]*)\{[^}]*min-height:\s*var\(--control-h\)/);
    expect(m, "не нашёл правило высоты однострочных полей").not.toBeNull();
    expect(m![1]).not.toContain(":not(");
    expect(m![1]).toContain('input[type="url"]');
  });

  // Отказ сервера в «Заказах и опросах» (и в 18 других экранах) — класс
  // `.employees-error`: красный текст на карточке и на подложке «10% красного
  // поверх карточки». Прежний #e23b32 давал 4.29 и 3.73 — ниже 4.5.
  it("красный текст ошибки читается: на карточке и на подложке ошибки не ниже 4.5", () => {
    const start = css.indexOf(":root {");
    const root = css.slice(start, css.indexOf("}", start));
    const rgb = (name: string) => {
      const h = root.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`))![1]!;
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    const red = rgb("fallback-destructive");
    const card = rgb("fallback-section-bg");
    const errorBg = card.map((c, i) => c * 0.9 + red[i]! * 0.1);
    expect(ratio(red, card)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(red, errorBg)).toBeGreaterThanOrEqual(4.5);
  });

  // «Опасная» кнопка — красный текст на красной подложке поверх того, что под ней. На
  // белой карточке выходило 4.59, на фоне страницы 4.01 и на вторичном фоне 3.65: ниже
  // 4.5. В покое текст, как и при наведении, сдвигается к цвету основного текста.
  it("«Опасная» кнопка в покое читается на карточке, странице и вторичном фоне: не ниже 4.5", () => {
    const start = css.indexOf(":root {");
    const root = css.slice(start, css.indexOf("}", start));
    const rgb = (name: string) => {
      const h = root.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`))![1]!;
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    };
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    const mix = (a: number[], b: number[], share: number) => a.map((v, i) => v * (1 - share) + b[i]! * share);
    const supports = css.slice(css.indexOf("@supports (color: color-mix(in srgb, red, blue)) {\n  .btn-danger {"));
    const textShare = Number(supports.match(/\.btn-danger \{\s*color: color-mix\(in srgb, var\(--destructive\) (\d+)%, var\(--text\)\)/)![1]) / 100;
    const tint = Number(css.match(/\.btn-danger \{[^}]*background: color-mix\(in srgb, var\(--destructive\) (\d+)%, transparent\)/)![1]) / 100;
    const red = rgb("fallback-destructive");
    const text = rgb("fallback-text");
    const label = mix(text, red, textShare);
    for (const surface of ["fallback-section-bg", "fallback-bg", "fallback-secondary-bg"]) {
      expect(ratio(label, mix(rgb(surface), red, tint)), surface).toBeGreaterThanOrEqual(4.5);
    }
  });
});
