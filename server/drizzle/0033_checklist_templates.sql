CREATE TABLE `checklist_templates` (
	`checklist_id` integer NOT NULL,
	`template_id` integer NOT NULL,
	PRIMARY KEY(`checklist_id`, `template_id`),
	FOREIGN KEY (`checklist_id`) REFERENCES `checklists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `shift_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `checklist_templates` (`checklist_id`, `template_id`)
SELECT `checklist_id`, `id` FROM `shift_templates` WHERE `checklist_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `reminder_log` SET `kind` = 'duty_checklist:' || (
	SELECT t.`checklist_id` FROM `shifts` s JOIN `shift_templates` t ON t.`id` = s.`template_id`
	WHERE s.`id` = `reminder_log`.`shift_id`
) WHERE `kind` = 'duty_checklist' AND EXISTS (
	SELECT 1 FROM `shifts` s JOIN `shift_templates` t ON t.`id` = s.`template_id`
	WHERE s.`id` = `reminder_log`.`shift_id` AND t.`checklist_id` IS NOT NULL
);
--> statement-breakpoint
ALTER TABLE `shift_templates` DROP COLUMN `checklist_id`;
