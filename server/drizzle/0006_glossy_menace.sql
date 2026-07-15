CREATE TABLE `calendar_days` (
	`date` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`note` text
);
--> statement-breakpoint
CREATE TABLE `template_pool` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_pool_unique` ON `template_pool` (`template_id`,`employee_id`);--> statement-breakpoint
CREATE TABLE `template_preference` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_preference_unique` ON `template_preference` (`template_id`,`employee_id`);--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `coverage` text DEFAULT '0,0,0,0,0,0,0' NOT NULL;--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `fill_mode` text DEFAULT 'count' NOT NULL;--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `rotation_unit` text DEFAULT 'day' NOT NULL;--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `primary_employee_id` integer REFERENCES employees(id);--> statement-breakpoint
-- Presets are owned by migrations from here on; seedDefaultTemplates is deleted.
-- Inserted in the order of the ids that already exist in production (1..5) so that
-- a fresh database and the live one converge on identical ids.
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Утро', 'shift', 'gold', NULL, '08:00', '17:00', '08:00', '15:45', 0, 1, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Утро');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'День', 'shift', 'blue', NULL, '09:00', '18:00', '09:00', '16:45', 0, 0, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'День');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Вечер', 'shift', 'violet', NULL, '11:00', '20:00', '12:00', '20:00', 1, 0, 2, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Вечер');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Ночь', 'shift', 'indigo', NULL, '15:00', '23:00', '16:00', '23:00', 1, 1, 3, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Ночь');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Дежурство · Поклонка', 'duty', 'teal', 'Поклонка', '09:00', '18:00', '09:00', '16:45', 0, 1, 4, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Дежурство · Поклонка');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Открытие', 'shift', 'amber', NULL, '07:00', '16:00', '07:00', '14:45', 0, 1, 5, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Открытие');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Дежурство · Телефон', 'duty', 'rose', NULL, '09:00', '18:00', '09:00', '16:45', 0, 1, 6, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Дежурство · Телефон');--> statement-breakpoint
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Дежурство · Вавилова 19', 'duty', 'green', 'Вавилова 19', '09:00', '18:00', '09:00', '16:45', 0, 1, 7, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Дежурство · Вавилова 19');--> statement-breakpoint
-- Authoritative values, applied by name. This is what fixes the live «Дежурство · Поклонка»,
-- whose hours were seeded as 09:00-21:00, and what makes re-running this block a no-op.
UPDATE `shift_templates` SET `category`='shift', `accent`='gold',   `location`=NULL,          `start`='08:00', `end`='17:00', `friday_start`='08:00', `friday_end`='15:45', `is_late`=0, `send_reminder`=1, `sort_order`=0 WHERE `name`='Утро';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='shift', `accent`='blue',   `location`=NULL,          `start`='09:00', `end`='18:00', `friday_start`='09:00', `friday_end`='16:45', `is_late`=0, `send_reminder`=0, `sort_order`=1 WHERE `name`='День';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='shift', `accent`='violet', `location`=NULL,          `start`='11:00', `end`='20:00', `friday_start`='12:00', `friday_end`='20:00', `is_late`=1, `send_reminder`=0, `sort_order`=2 WHERE `name`='Вечер';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='shift', `accent`='indigo', `location`=NULL,          `start`='15:00', `end`='23:00', `friday_start`='16:00', `friday_end`='23:00', `is_late`=1, `send_reminder`=1, `sort_order`=3 WHERE `name`='Ночь';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='duty',  `accent`='teal',   `location`='Поклонка',    `start`='09:00', `end`='18:00', `friday_start`='09:00', `friday_end`='16:45', `is_late`=0, `send_reminder`=1, `sort_order`=4 WHERE `name`='Дежурство · Поклонка';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='shift', `accent`='amber',  `location`=NULL,          `start`='07:00', `end`='16:00', `friday_start`='07:00', `friday_end`='14:45', `is_late`=0, `send_reminder`=1, `sort_order`=5 WHERE `name`='Открытие';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='duty',  `accent`='rose',   `location`=NULL,          `start`='09:00', `end`='18:00', `friday_start`='09:00', `friday_end`='16:45', `is_late`=0, `send_reminder`=1, `sort_order`=6 WHERE `name`='Дежурство · Телефон';--> statement-breakpoint
UPDATE `shift_templates` SET `category`='duty',  `accent`='green',  `location`='Вавилова 19', `start`='09:00', `end`='18:00', `friday_start`='09:00', `friday_end`='16:45', `is_late`=0, `send_reminder`=1, `sort_order`=7 WHERE `name`='Дежурство · Вавилова 19';