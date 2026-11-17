ALTER TABLE `food_close_messages` ADD `stop_poll` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `food_close_messages` ADD `native_poll_summary` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `food_close_messages` ADD `awaiting_poll_snapshot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `poll_recipients` ADD `telegram_poll_id` text;--> statement-breakpoint
ALTER TABLE `poll_recipients` ADD `telegram_poll_chat_id` integer;--> statement-breakpoint
ALTER TABLE `poll_recipients` ADD `telegram_choices` text;--> statement-breakpoint
ALTER TABLE `poll_recipients` ADD `telegram_finalized` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `poll_recipient_telegram_poll` ON `poll_recipients` (`telegram_poll_id`);--> statement-breakpoint
ALTER TABLE `polls` ADD `telegram_options` text;--> statement-breakpoint
ALTER TABLE `polls` ADD `telegram_multiple` integer DEFAULT false NOT NULL;