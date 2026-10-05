-- Только пять колонок `shifts`, индекс и таблица писем запроса ОК. drizzle-kit может
-- приложить сюда то, что уже есть в базе (см. шапку 0036), — повторное создание таблицы
-- уронило бы выкатку. Пересоздавать `shifts` нельзя: на неё ссылаются пять таблиц.
-- ON DELETE set null у колонки дописан руками: ALTER ADD COLUMN у drizzle-kit его теряет.
-- Индекс частичный: обычный SQLite не берёт под `IS NOT NULL`, а ждущих строк единицы.
ALTER TABLE `shifts` ADD `approval_requested_at` integer;--> statement-breakpoint
ALTER TABLE `shifts` ADD `approved_by_employee_id` integer REFERENCES employees(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `shifts` ADD `handover_forced_at` integer;--> statement-breakpoint
ALTER TABLE `shifts` ADD `approved_date` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `approved_end_date` text;--> statement-breakpoint
CREATE INDEX `shift_pending_approval` ON `shifts` (`approval_requested_at`) WHERE `approval_requested_at` is not null;--> statement-breakpoint
CREATE TABLE `sick_leave_approval_messages` (
	`shift_id` integer NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	PRIMARY KEY(`chat_id`, `message_id`),
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sick_approval_message_shift` ON `sick_leave_approval_messages` (`shift_id`);
