import { loadConfig, type Config } from "./config";

/**
 * Конфиг для тестов — собранный `loadConfig`, а не набранный руками.
 *
 * Литерал `const config: Config = {...}` жил в 26 тестовых файлах, и цена этого
 * платилась каждый раз, когда конфиг растёт: два новых поля передачи смены
 * (`handoverFanHours`, `handoverEscalateHours`) разом сломали typecheck в
 * семнадцати файлах. Копии не расходились только потому, что `tsc` бил по рукам, —
 * то есть дисциплину держал компилятор, а не устройство кода.
 *
 * Собирается через `loadConfig` с фальшивым env намеренно: тест получает ровно те
 * значения по умолчанию, что прод, и новое поле с дефолтом приезжает во все тесты
 * само. Заодно это поймало мелочь: в пяти файлах `jwtSecret` был длиной 23
 * символа, тогда как `loadConfig` требует 32 — тесты работали на конфиге, который
 * настоящий сервер отверг бы на старте.
 *
 * `patch` накладывается ПОСЛЕ разбора, поэтому им можно выразить и то, чего env
 * выразить не может: например пустой `adminTelegramIds` (в схеме список
 * непустой) — так проверяется поведение «в аллоулисте никого».
 */
export function testConfig(patch: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      BOT_TOKEN: "12345:tok",
      ADMIN_TELEGRAM_IDS: "111",
      TEAM_TZ: "Europe/Moscow",
      DATABASE_URL: ":memory:",
      JWT_SECRET: "test-jwt-secret-that-is-long-enough-0123",
      PUBLIC_URL: "https://x.keenetic.pro",
    }),
    ...patch,
  };
}
