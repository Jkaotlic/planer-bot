ALTER TABLE `calendar_days` ADD `source` text DEFAULT 'auto' NOT NULL;
--> statement-breakpoint
ALTER TABLE `calendar_days` ADD `updated_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `calendar_days` SET `updated_at` = unixepoch();
