-- Только новые таблицы групп адресатов и одна колонка у сборов. drizzle-kit может
-- приложить сюда то, что уже есть в базе (см. шапку 0036), — повторный CREATE TABLE
-- уронил бы выкатку. Порядок: колонка `collections` ссылается на recipient_groups.
CREATE TABLE `recipient_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_by` integer NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `collections` ADD `recipient_group_id` integer REFERENCES recipient_groups(id);
--> statement-breakpoint
CREATE TABLE `recipient_group_members` (
	`group_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	PRIMARY KEY(`group_id`, `employee_id`),
	FOREIGN KEY (`group_id`) REFERENCES `recipient_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `collection_recipients` (
	`collection_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `employee_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
