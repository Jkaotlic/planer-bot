import { z } from "zod";

const intList = z
  .string()
  .transform((s) => s.split(",").map((p) => p.trim()).filter(Boolean))
  .pipe(z.array(z.coerce.number().int()).min(1));

const schema = z.object({
  BOT_TOKEN: z.string().min(1),
  ADMIN_TELEGRAM_IDS: intList,
  TEAM_TZ: z
    .string()
    .min(1)
    .default("Europe/Moscow")
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "invalid IANA timezone"),
  DATABASE_URL: z.string().min(1).default("./data/planer.db"),
  /**
   * Куда ложатся файлы инструкций к чек-листам.
   *
   * Рядом с базой и с дефолтом: выкладка не должна требовать правки боевого
   * `.env` ради каталога, который почти не меняется, — тот же довод, что у
   * порогов передачи смены ниже.
   */
  DOCS_DIR: z.string().min(1).default("./data/checklist-docs"),
  JWT_SECRET: z.string().min(32),
  PUBLIC_URL: z.string().url(),
  BOT_USERNAME: z.string().optional(),
  /**
   * Пороги лестницы передачи смены: сколько ждём ответа адресата, прежде чем
   * звать всех, и за сколько часов до смены зовём админов.
   *
   * Со значениями по умолчанию намеренно: иначе выкладка потребовала бы править
   * `server/.env` на живой машине ради двух чисел, которые почти не меняются, —
   * а каждая правка боевого .env это шанс уронить сервис на старте.
   */
  HANDOVER_FAN_HOURS: z.coerce.number().positive().default(3),
  HANDOVER_ESCALATE_HOURS: z.coerce.number().positive().default(12),
});

export interface Config {
  botToken: string;
  adminTelegramIds: number[];
  teamTz: string;
  databaseUrl: string;
  /** Каталог файлов инструкций — см. `DOCS_DIR`. */
  docsDir: string;
  jwtSecret: string;
  publicUrl: string;
  botUsername?: string;
  handoverFanHours: number;
  handoverEscalateHours: number;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    botToken: e.BOT_TOKEN,
    adminTelegramIds: e.ADMIN_TELEGRAM_IDS,
    teamTz: e.TEAM_TZ,
    databaseUrl: e.DATABASE_URL,
    docsDir: e.DOCS_DIR,
    jwtSecret: e.JWT_SECRET,
    publicUrl: e.PUBLIC_URL,
    botUsername: e.BOT_USERNAME,
    handoverFanHours: e.HANDOVER_FAN_HOURS,
    handoverEscalateHours: e.HANDOVER_ESCALATE_HOURS,
  };
}
