CREATE TABLE `handover_declines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`handover_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`declined_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`handover_id`) REFERENCES `handovers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `handover_decline_unique` ON `handover_declines` (`handover_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `handovers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shift_id` integer,
	`from_employee_id` integer NOT NULL,
	`sick_entry_id` integer,
	`status` text DEFAULT 'offered' NOT NULL,
	`offered_to_employee_id` integer,
	`offered_at` integer DEFAULT (unixepoch()) NOT NULL,
	`escalated_at` integer,
	`taken_by_employee_id` integer,
	`resolved_at` integer,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sick_entry_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`offered_to_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`taken_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
