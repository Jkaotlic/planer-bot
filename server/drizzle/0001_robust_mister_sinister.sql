PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`start` text,
	`end` text,
	`end_date` text,
	`category` text DEFAULT 'shift' NOT NULL,
	`location` text,
	`template_id` integer,
	`title` text,
	`employee_id` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_shifts`("id", "date", "start", "end", "template_id", "title", "employee_id", "note", "created_at", "updated_at") SELECT "id", "date", "start", "end", "template_id", "title", "employee_id", "note", "created_at", "updated_at" FROM `shifts`;--> statement-breakpoint
DROP TABLE `shifts`;--> statement-breakpoint
ALTER TABLE `__new_shifts` RENAME TO `shifts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `employees` ADD `archived_at` integer;