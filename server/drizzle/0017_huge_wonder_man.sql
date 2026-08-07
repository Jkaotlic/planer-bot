CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by_employee_id` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`updated_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `employees` ADD `excluded_from_assignment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `excluded_from_swaps` integer DEFAULT false NOT NULL;