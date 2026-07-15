DROP INDEX `weekend_assignment_slot`;--> statement-breakpoint
CREATE UNIQUE INDEX `weekend_assignment_slot_employee` ON `weekend_assignments` (`slot_id`,`employee_id`);