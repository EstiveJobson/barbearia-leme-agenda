-- Demo login, sample agenda, reset, banner, and disabled push apply only
-- when DEMO_MODE is on and this flag is true. Never inferred from a slug.

alter table shops
  add column is_demo boolean not null default false;
