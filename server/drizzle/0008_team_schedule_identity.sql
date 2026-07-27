UPDATE `shifts`
SET `title` = 'Дежурство с 07:00'
WHERE `template_id` IN (
  SELECT `id` FROM `shift_templates` WHERE `name` = 'Открытие'
)
AND `title` = 'Открытие';
--> statement-breakpoint

UPDATE `shift_templates`
SET `name` = 'Дежурство с 07:00',
    `category` = 'duty',
    `is_active` = 1
WHERE `name` = 'Открытие';
