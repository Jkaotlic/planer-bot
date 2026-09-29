-- Только новые таблицы: места и их меню. drizzle-kit может приложить сюда то,
-- что уже есть в базе (см. шапку 0036), — повторный CREATE TABLE уронил бы выкатку.
CREATE TABLE `food_places` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_by` integer NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `food_menu_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` integer NOT NULL,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`place_id`) REFERENCES `food_places`(`id`) ON UPDATE no action ON DELETE no action
);
