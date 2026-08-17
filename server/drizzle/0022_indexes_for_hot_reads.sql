CREATE INDEX `audit_created` ON `audit_log` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `shift_date` ON `shifts` (`date`);--> statement-breakpoint
CREATE INDEX `shift_employee_date` ON `shifts` (`employee_id`,`date`);--> statement-breakpoint
CREATE INDEX `swap_from_employee` ON `swap_requests` (`from_employee_id`);--> statement-breakpoint
CREATE INDEX `swap_to_employee` ON `swap_requests` (`to_employee_id`);--> statement-breakpoint
CREATE INDEX `swap_from_shift` ON `swap_requests` (`from_shift_id`);--> statement-breakpoint
CREATE INDEX `swap_to_shift` ON `swap_requests` (`to_shift_id`);--> statement-breakpoint
CREATE INDEX `vacant_slot_date` ON `vacant_slots` (`date`);