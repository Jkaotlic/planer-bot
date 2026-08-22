CREATE TABLE `checklists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`doc_url` text,
	`doc_file_id` text,
	`doc_name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `checklist_items` ADD `checklist_id` integer REFERENCES checklists(`id`);
--> statement-breakpoint
ALTER TABLE `shift_templates` ADD `checklist_id` integer REFERENCES checklists(`id`);
--> statement-breakpoint
-- Перенос того, что успело завестись до этой правки: один чек-лист на систему
-- превращается в один именованный, и на него ссылаются те же виды смен, у
-- которых стояла галочка. Ничего не создаётся, если пунктов не было вовсе —
-- пустой чек-лист «Чек-лист дежурного» в списке был бы мусором, который надо
-- удалять руками.
INSERT INTO `checklists` (`name`, `note`, `doc_url`, `doc_file_id`, `doc_name`)
SELECT
	'Чек-лист дежурного',
	(SELECT `value` FROM `app_settings` WHERE `key` = 'checklist_note'),
	(SELECT `value` FROM `app_settings` WHERE `key` = 'checklist_doc_url'),
	(SELECT `value` FROM `app_settings` WHERE `key` = 'checklist_doc_file_id'),
	(SELECT `value` FROM `app_settings` WHERE `key` = 'checklist_doc_name')
WHERE EXISTS (SELECT 1 FROM `checklist_items`);
--> statement-breakpoint
UPDATE `checklist_items` SET `checklist_id` = (SELECT `id` FROM `checklists` ORDER BY `id` LIMIT 1)
WHERE `checklist_id` IS NULL;
--> statement-breakpoint
UPDATE `shift_templates` SET `checklist_id` = (SELECT `id` FROM `checklists` ORDER BY `id` LIMIT 1)
WHERE `requires_checklist` = 1 AND EXISTS (SELECT 1 FROM `checklists`);
--> statement-breakpoint
DELETE FROM `app_settings` WHERE `key` IN ('checklist_note', 'checklist_doc_url', 'checklist_doc_file_id', 'checklist_doc_name', 'checklist_doc_pending');
--> statement-breakpoint
ALTER TABLE `shift_templates` DROP COLUMN `requires_checklist`;
