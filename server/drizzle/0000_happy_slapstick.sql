CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`actor_employee_id` integer,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`actor_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_user_id` integer,
	`tg_username` text,
	`display_name` text NOT NULL,
	`phone` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`reminders_enabled` integer DEFAULT true NOT NULL,
	`prep_buffer_min` integer DEFAULT 60 NOT NULL,
	`invite_token` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_telegramUserId_unique` ON `employees` (`telegram_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `employees_inviteToken_unique` ON `employees` (`invite_token`);--> statement-breakpoint
CREATE TABLE `reminder_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shift_id` integer NOT NULL,
	`kind` text NOT NULL,
	`sent_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_shift_kind` ON `reminder_log` (`shift_id`,`kind`);--> statement-breakpoint
CREATE TABLE `shift_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`friday_start` text,
	`friday_end` text,
	`is_late` integer DEFAULT false NOT NULL,
	`send_reminder` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`start` text NOT NULL,
	`end` text NOT NULL,
	`template_id` integer,
	`title` text,
	`employee_id` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `swap_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_employee_id` integer NOT NULL,
	`from_shift_id` integer NOT NULL,
	`to_employee_id` integer NOT NULL,
	`to_shift_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`from_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
