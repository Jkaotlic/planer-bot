CREATE TABLE `collection_link_pending` (
	`employee_id` integer PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `collections` ADD `auto_send_on` text;--> statement-breakpoint
ALTER TABLE `collections` ADD `auto_sent_at` integer;
