import { z } from "zod";

const intList = z
  .string()
  .transform((s) => s.split(",").map((p) => p.trim()).filter(Boolean))
  .pipe(z.array(z.coerce.number().int()));

const schema = z.object({
  BOT_TOKEN: z.string().min(1),
  ADMIN_TELEGRAM_IDS: intList,
  TEAM_TZ: z.string().min(1).default("Europe/Moscow"),
  DATABASE_URL: z.string().min(1).default("./data/planer.db"),
  JWT_SECRET: z.string().min(16),
  PUBLIC_URL: z.string().url(),
});

export interface Config {
  botToken: string;
  adminTelegramIds: number[];
  teamTz: string;
  databaseUrl: string;
  jwtSecret: string;
  publicUrl: string;
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
    jwtSecret: e.JWT_SECRET,
    publicUrl: e.PUBLIC_URL,
  };
}
