import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/src/**/*.test.{ts,tsx}"],
    // Копия ветки внутри репо (superpowers: `.claude/worktrees/`, `.worktrees/`) несёт
    // свои src/**/*.test.ts, и шаблон выше забирает их: `npm test` в рабочей папке
    // гонял бы тесты чужой ветки вторым комплектом. Свой exclude заменяет умолчания
    // vitest, поэтому они дописываются, а не теряются (иначе пошёл бы node_modules).
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/.worktrees/**"],
    environment: "node",
  },
});
