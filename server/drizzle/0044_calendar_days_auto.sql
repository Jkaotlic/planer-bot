-- Две nullable-колонки, без пересоздания таблицы — проверено, что drizzle-kit положил сюда
-- только ADD. Старые строки получают NULL: ручная строка до этой миграции не знает, что было
-- под ней, и снятие отметки берёт запасное значение из зашитого календаря (repo/calendar-days.ts).
ALTER TABLE `calendar_days` ADD `auto_kind` text;--> statement-breakpoint
ALTER TABLE `calendar_days` ADD `auto_note` text;