CREATE TABLE `slot_interest` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slot_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `vacant_slots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slot_interest_unique` ON `slot_interest` (`slot_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `vacant_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`title` text,
	`location` text,
	`note` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weekend_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slot_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`status` text DEFAULT 'offered' NOT NULL,
	`hours` real NOT NULL,
	`shift_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`confirmed_at` integer,
	FOREIGN KEY (`slot_id`) REFERENCES `vacant_slots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `weekend_assignment_slot` ON `weekend_assignments` (`slot_id`);