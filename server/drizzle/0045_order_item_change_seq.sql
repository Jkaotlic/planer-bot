-- Одна колонка ADD, без пересоздания таблицы — проверено, что drizzle-kit положил сюда
-- только ADD. NOT NULL с DEFAULT 0: старые строки получают 0, и «Убрать» среди них решает
-- ничью по id — то же поведение, что было до миграции (server/src/orders/order-service.ts).
ALTER TABLE `food_order_items` ADD `change_seq` integer DEFAULT 0 NOT NULL;