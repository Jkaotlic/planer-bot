ALTER TABLE `poll_recipients` ADD `telegram_invite_state` text;--> statement-breakpoint
ALTER TABLE `poll_recipients` ADD `telegram_invite_retry_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `poll_recipient_telegram_invite_due` ON `poll_recipients` (`telegram_invite_state`,`telegram_invite_retry_at`);--> statement-breakpoint
ALTER TABLE `polls` ADD `telegram_manual_closed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `polls` ADD `telegram_result_text` text;