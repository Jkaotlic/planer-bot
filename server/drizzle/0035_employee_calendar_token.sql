ALTER TABLE `employees` ADD `calendar_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `employees_calendar_token_unique` ON `employees` (`calendar_token`);
