-- Owner devices that asked for Web Push. shop_id is always the session shop.
-- endpoint is the push service URL from the browser, never a raw IP.

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  owner_account_id uuid not null references owner_accounts (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (shop_id, endpoint)
);

create index push_subscriptions_shop_id_idx on push_subscriptions (shop_id);
