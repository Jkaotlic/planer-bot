-- Старые отметки оставляем для отката. В них нет получателя, поэтому копию
-- связываем с дежурным на момент миграции, если он назначен.
INSERT OR IGNORE INTO `reminder_log` (`shift_id`, `kind`, `sent_at`)
SELECT r.`shift_id`, r.`kind`
  || CASE WHEN instr(r.`kind`, '@') = 0 THEN '@' || s.`date` ELSE '' END
  || '#' || s.`employee_id`, r.`sent_at`
FROM `reminder_log` AS r
JOIN `shifts` AS s ON r.`shift_id` = s.`id`
WHERE s.`employee_id` IS NOT NULL
  AND instr(r.`kind`, '#') = 0
  AND (r.`kind` GLOB 'duty_checklist:[0-9]*'
    OR r.`kind` GLOB 'duty_checklist_doc:[0-9]*'
    OR r.`kind` GLOB 'duty_checklist_undeliverable:[0-9]*')
ORDER BY r.`id`;
