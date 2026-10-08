-- Шесть колонок, без новых таблиц. drizzle-kit может приложить сюда то, что уже есть в
-- базе (см. шапку 0036) — проверено, что здесь только ADD. Старые строки получают `pcs`
-- и `allow_custom = 1`: ни одно меню и заказ не меняется.
ALTER TABLE `food_menu_items` ADD `unit` text DEFAULT 'pcs' NOT NULL;--> statement-breakpoint
ALTER TABLE `food_menu_items` ADD `step_grams` integer;--> statement-breakpoint
ALTER TABLE `food_order_items` ADD `unit` text DEFAULT 'pcs' NOT NULL;--> statement-breakpoint
ALTER TABLE `food_order_items` ADD `step_grams` integer;--> statement-breakpoint
ALTER TABLE `food_orders` ADD `title` text;--> statement-breakpoint
ALTER TABLE `food_orders` ADD `allow_custom` integer DEFAULT true NOT NULL;
