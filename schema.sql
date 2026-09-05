-- Состояние трекера целиком лежит одной JSON-строкой:
-- { start, updatedAt, done: { "12:3": true }, weights: { "12": 101.4 } }
-- Объём за все 100 дней — единицы килобайт, разносить по таблицам незачем.

create table if not exists state (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
