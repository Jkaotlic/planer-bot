CREATE TABLE `calendar_days` (
	`date` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `template_pool` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_pool_unique` ON `template_pool` (`template_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `template_preference` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_preference_unique` ON `template_preference` (`template_id`,`employee_id`);--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `coverage` text DEFAULT '0,0,0,0,0,0,0' NOT NULL;--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `fill_mode` text DEFAULT 'count' NOT NULL;--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `rotation_unit` text DEFAULT 'day' NOT NULL;--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `primary_employee_id` integer REFERENCES employees(id);