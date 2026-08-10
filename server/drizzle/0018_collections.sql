PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text DEFAULT 'custom' NOT NULL,
	`employee_id` integer,
	`year` integer,
	`celebrated_on` text,
	`title` text,
	`event_date` text,
	`deadline` text,
	`amount_per_person` integer,
	`total_goal` integer,
	`collect_url` text,
	`message_text` text,
	`closed_at` integer,
	`admin_notified_at` integer,
	`scheduled_send_on` text,
	`schedule_notified_at` integer,
	`sent_at` integer,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`send_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_collections`(
	"id", "kind", "employee_id", "year", "celebrated_on",
	"collect_url", "message_text", "admin_notified_at",
	"scheduled_send_on", "schedule_notified_at",
	"sent_at", "sent_count", "send_count", "created_at"
) SELECT
	"id", 'birthday', "employee_id", "year", "celebrated_on",
	"collect_url", "message_text", "admin_notified_at",
	"scheduled_send_on", "schedule_notified_at",
	"sent_at", "sent_count",
	-- `status='sent'` в старой таблице означал «рассылали ровно один раз»:
	-- повторить было нечем. Отсюда и берётся счётчик рассылок.
	CASE WHEN "sent_at" IS NOT NULL THEN 1 ELSE 0 END,
	"created_at"
FROM `birthday_campaigns`;--> statement-breakpoint
DROP TABLE `birthday_campaigns`;--> statement-breakpoint
ALTER TABLE `__new_collections` RENAME TO `collections`;--> statement-breakpoint
CREATE UNIQUE INDEX `collection_birthday_unique` ON `collections` (`employee_id`,`year`) WHERE `kind` = 'birthday';--> statement-breakpoint
PRAGMA foreign_keys=ON;
