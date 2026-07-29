-- «Дежурство · Резерв» — the reserve duty officer (`rezerv` in the roster file).
--
-- Hand-written rather than generated: drizzle-kit only diffs schema, and this is
-- a data row. Same shape as the preset seeding in 0006 — guarded INSERT plus an
-- authoritative UPDATE, so re-running it is a no-op and a preset already added by
-- hand under the same name is corrected rather than duplicated.
INSERT INTO `shift_templates` (`name`, `category`, `accent`, `location`, `start`, `end`, `friday_start`, `friday_end`, `is_late`, `send_reminder`, `sort_order`, `is_active`)
SELECT 'Дежурство · Резерв', 'duty', 'emerald', NULL, '09:00', '18:00', '09:00', '16:45', 0, 1, 8, 1
WHERE NOT EXISTS (SELECT 1 FROM `shift_templates` WHERE `name` = 'Дежурство · Резерв');--> statement-breakpoint
UPDATE `shift_templates` SET `category`='duty', `accent`='emerald', `location`=NULL, `start`='09:00', `end`='18:00', `friday_start`='09:00', `friday_end`='16:45', `is_late`=0, `send_reminder`=1, `sort_order`=8, `is_active`=1 WHERE `name`='Дежурство · Резерв';
