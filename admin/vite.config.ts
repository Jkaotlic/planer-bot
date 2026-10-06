import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the server under /admin/ once deployed (see server workspace).
export default defineConfig({
  plugins: [react()],
  base: "/admin/",
  build: {
    outDir: "dist",
    /**
     * Планка совместимости задана руками, потому что умолчание Vite отрезает
     * половину команды.
     *
     * С 6-й версии Vite собирает под `baseline-widely-available` — сейчас это
     * Chrome 111 и Safari 16.4, то есть iOS 16.4 (март 2023). iPhone 7, 6s и
     * SE первого поколения дальше iOS 15.8 не обновляются в принципе. На таком
     * телефоне модуль не парсится целиком: не выполняется ни одна строка, не
     * срабатывает ни один обработчик ошибок, человек видит белый экран — и так
     * будет всегда, потому что это свойство устройства, а не сбой.
     *
     * iOS 14 выбрана нижней границей: она покрывает каждый айфон, доживший до
     * своей последней прошивки, и не требует понижать код до ES2015, где
     * esbuild переписывает async/await в генераторы. Что понизить нельзя —
     * рантайм-вызовы вроде `Object.hasOwn` — ловит `ops/check-bundle-baseline.mjs`
     * на каждой сборке и лечится полифилом в `index.html`.
     */
    target: ["es2020", "chrome87", "edge88", "firefox78", "safari14", "ios14"],
    rollupOptions: {
      treeshake: {
        /**
         * DEV-мок (`src/api/mock.ts`) заводит состояние и моки на верхнем уровне
         * модуля, и сборщик считал это побочными эффектами: сид «Аня Смирнова»,
         * мок работников, еды и чтения уезжали в боевой бандл (+17–23 КБ,
         * «Шаурма…» в client-*.js). У мока побочных эффектов и правда нет — он
         * только заводит данные, — поэтому, пока `createDevClient` вырезан
         * (`import.meta.env.DEV` ложно), модуль выбрасывается целиком. Страховка —
         * `ops/check-bundle-baseline.mjs`: ищет маркеры мока в собранном JS.
         */
        moduleSideEffects: (id: string) => !/[\\/]src[\\/]api[\\/]mock\.ts$/.test(id),
      },
    },
  },
});
