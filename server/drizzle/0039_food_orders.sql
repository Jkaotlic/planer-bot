-- Только новые таблицы: заказ, позиции, отказы, отметки о сдаче. drizzle-kit
-- может приложить сюда то, что уже есть в базе (см. шапку 0036), — повторный
-- CREATE TABLE уронил бы выкатку.
CREATE TABLE `food_order_declines` (
	`order_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	PRIMARY KEY(`order_id`, `employee_id`),
	FOREIGN KEY (`order_id`) REFERENCES `food_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `food_order_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`menu_item_id` integer,
	`name` text NOT NULL,
	`price` integer NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `food_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_item_id`) REFERENCES `food_menu_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `food_order_items_order` ON `food_order_items` (`order_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `food_order_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`marked_by` integer NOT NULL,
	`marked_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `food_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`marked_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_order_payment_unique` ON `food_order_payments` (`order_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `food_order_recipients` (
	`order_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`message_id` integer,
	PRIMARY KEY(`order_id`, `employee_id`),
	FOREIGN KEY (`order_id`) REFERENCES `food_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `food_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_by` integer NOT NULL,
	`place_id` integer,
	`note` text,
	`pay_hint` text,
	`closes_at` text,
	`closed_at` integer,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`place_id`) REFERENCES `food_places`(`id`) ON UPDATE no action ON DELETE no action
);
