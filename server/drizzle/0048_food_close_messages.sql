CREATE TABLE `food_close_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`employee_id` integer NOT NULL,
	`telegram_user_id` integer NOT NULL,
	`message_id` integer,
	`body` text,
	`keyboard` text,
	`payment_order_id` integer,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_order_id`) REFERENCES `food_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `food_close_messages_due` ON `food_close_messages` (`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `food_close_messages_scope` ON `food_close_messages` (`scope`);