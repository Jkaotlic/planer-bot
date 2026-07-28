CREATE TABLE `birthday_campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`year` integer NOT NULL,
	`celebrated_on` text NOT NULL,
	`collect_url` text,
	`message_text` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`admin_notified_at` integer,
	`sent_at` integer,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `birthday_campaign_unique` ON `birthday_campaigns` (`employee_id`,`year`);