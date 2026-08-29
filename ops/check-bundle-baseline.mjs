#!/usr/bin/env node
/**
 * Постусловие сборки фронта: собранный бандл обязан запускаться на телефонах,
 * которые у команды реально есть.
 *
 * Зачем это вообще: Vite с 6-й версии собирает под `baseline-widely-available`,
 * а это Chrome 111 / Safari 16.4 — то есть iOS 16.4, март 2023 года. iPhone 7,
 * 6s и SE первого поколения дальше iOS 15.8 не обновляются НИКОГДА. На таком
 * телефоне модуль не парсится целиком — ни одна строка кода не выполняется, ни
 * один обработчик ошибок не срабатывает, человек видит белый экран. И так у него
 * будет всегда: это свойство устройства, а не сбой. Симптом «не работает у
 * одних и тех же людей» — ровно это.
 *
 * Проверка живёт скриптом, а не тестом, потому что смотреть надо на артефакт
 * сборки (`dist/` в gitignore, в тестовом прогоне его может не быть), и потому
 * что польза от неё именно в момент сборки: не дать выкатить бандл, который у
 * части команды не откроется.
 *
 * Синтаксис esbuild понижает сам, если задан `build.target`. Рантайм-вызовы —
 * не понижает: `Object.hasOwn` из valibot (его тянет @telegram-apps/sdk) на
 * iOS 15.3 бросит TypeError уже при старте SDK. Такие вызовы ловятся отдельным
 * списком и лечатся полифилом в `index.html`, а не таргетом.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Планка: самая старая система, на которой мини-апп обязан открываться. */
export const BASELINE = "iOS 14 / Chrome 87";

/**
 * Что искать. `pattern` — по собранному коду; `since` — с какой версии Safari
 * это появилось, то есть кому именно оно ломает запуск.
 */
const SYNTAX = [
  { name: "логическое присваивание (??= ||= &&=)", pattern: /(\?\?=|\|\|=|&&=)/g, since: "Safari 14" },
  { name: "статический блок класса (static {})", pattern: /\bstatic\s*\{/g, since: "Safari 16.4" },
  { name: "приватное поле в проверке (#x in obj)", pattern: /#[A-Za-z_$][\w$]*\s+in\s/g, since: "Safari 16.4" },
];

/**
 * `polyfill` — как выглядит подмена этого вызова в `index.html`. Если она там
 * есть, вызов в бандле безопасен: разметка выполняется раньше модуля. Без этой
 * поблажки проверка требовала бы убрать вызов, который живёт в чужой библиотеке
 * (`Object.hasOwn` зовёт valibot внутри Telegram SDK) и убран быть не может.
 */
const RUNTIME = [
  { name: "Object.hasOwn", pattern: /\bObject\.hasOwn\b/g, since: "Safari 15.4", polyfill: /Object\.hasOwn\s*=/ },
  { name: "Array.prototype.at", pattern: /\.at\(\s*-?\d/g, since: "Safari 15.4" },
  { name: "structuredClone", pattern: /\bstructuredClone\b/g, since: "Safari 15.4" },
  { name: "Array.prototype.findLast", pattern: /\.findLast(Index)?\(/g, since: "Safari 15.4" },
  { name: "Object.groupBy", pattern: /\bObject\.groupBy\b/g, since: "Safari 17.4" },
  { name: "Array.prototype.toSorted", pattern: /\.to(Sorted|Reversed|Spliced)\(/g, since: "Safari 16" },
  { name: "crypto.randomUUID", pattern: /\bcrypto\.randomUUID\b/g, since: "Safari 15.4" },
];

/** Считает попадания каждого правила в тексте. Пустой массив — чисто. */
export function scan(code, rules) {
  return rules
    .map((rule) => ({ ...rule, hits: (code.match(rule.pattern) ?? []).length }))
    .filter((rule) => rule.hits > 0);
}

function jsFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((name) => typeof name === "string" && name.endsWith(".js"))
    .map((name) => join(dir, name));
}

/** Что из рантайма уже подменено в разметке этой сборки. */
function polyfilled(dir) {
  const indexPath = join(dir, "index.html");
  if (!existsSync(indexPath)) return [];
  const html = readFileSync(indexPath, "utf8");
  return RUNTIME.filter((rule) => rule.polyfill && rule.polyfill.test(html)).map((rule) => rule.name);
}

function main() {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("usage: check-bundle-baseline.mjs <dist-dir> [<dist-dir>...]");
    process.exit(2);
  }

  let bad = 0;
  for (const dir of dirs) {
    const covered = polyfilled(dir);
    if (covered.length > 0) console.log(`  ${dir}: подменено в index.html — ${covered.join(", ")}`);
    for (const file of jsFiles(dir)) {
      const code = readFileSync(file, "utf8");
      for (const found of scan(code, SYNTAX)) {
        bad += 1;
        console.error(`СИНТАКСИС ${file}: ${found.name} ×${found.hits} — не парсится ниже ${found.since}`);
      }
      for (const found of scan(code, RUNTIME).filter((rule) => !covered.includes(rule.name))) {
        bad += 1;
        console.error(`РАНТАЙМ   ${file}: ${found.name} ×${found.hits} — падает ниже ${found.since}`);
      }
    }
  }

  if (bad > 0) {
    console.error(`\n✗ бандл не откроется на ${BASELINE}: нарушений ${bad}.`);
    console.error("  Синтаксис лечится build.target в vite.config.ts, рантайм — полифилом в index.html.");
    process.exit(1);
  }
  console.log(`✓ бандл открывается на ${BASELINE}`);
}

// Запуск только как скрипта: импорт в тесте не должен ронять процесс.
if (process.argv[1]?.endsWith("check-bundle-baseline.mjs")) main();
