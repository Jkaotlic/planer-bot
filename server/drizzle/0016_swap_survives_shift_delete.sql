PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_swap_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_employee_id` integer NOT NULL,
	`from_shift_id` integer,
	`to_employee_id` integer NOT NULL,
	`to_shift_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`from_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_swap_requests`("id", "from_employee_id", "from_shift_id", "to_employee_id", "to_shift_id", "status", "message", "created_at", "resolved_at") SELECT "id", "from_employee_id", "from_shift_id", "to_employee_id", "to_shift_id", "status", "message", "created_at", "resolved_at" FROM `swap_requests`;--> statement-breakpoint
DROP TABLE `swap_requests`;--> statement-breakpoint
ALTER TABLE `__new_swap_requests` RENAME TO `swap_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;