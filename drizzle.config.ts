import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./server/src/db/schema.ts",
  out: "./server/drizzle",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL ?? "./data/planer.db" },
});
