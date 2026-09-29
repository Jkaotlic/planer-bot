-- Только таблицы опросов. drizzle-kit может приложить сюда то, что уже есть в
-- базе (см. шапку 0036), — повторный CREATE TABLE уронил бы выкатку.
CREATE TABLE `polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_by` integer NOT NULL,
	`question` text NOT NULL,
	`closes_at` text,
	`closed_at` integer,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `poll_recipients` (
	`poll_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`message_id` integer,
	PRIMARY KEY(`poll_id`, `employee_id`),
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `poll_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poll_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`choice` text NOT NULL,
	`voted_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `polls`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `poll_vote_unique` ON `poll_votes` (`poll_id`,`employee_id`);
