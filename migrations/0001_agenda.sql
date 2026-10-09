-- Multi-shop agenda. Business rows (everything except shops) carry shop_id.
-- Booking instants are timestamptz (UTC). Weekly hours are wall-clock times
-- in shops.timezone, not UTC.

create table shops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  timezone text not null,
  tagline text,
  intro text,
  city_line text,
  seo_description text,
  whatsapp text,
  instagram text,
  address text,
  map_query text,
  slot_minutes integer not null default 30,
  year integer,
  created_at timestamptz not null default now()
);

create table barbers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  slug text not null,
  name text not null,
  specialty text,
  photo text,
  sort_order integer not null default 0,
  unique (shop_id, slug)
);

create index barbers_shop_id_idx on barbers (shop_id);

create table services (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  duration_minutes integer not null check (duration_minutes > 0),
  sort_order integer not null default 0,
  unique (shop_id, slug)
);

create index services_shop_id_idx on services (shop_id);

-- Recurring weekly hours for one barber. No row means that weekday is closed.
-- start_time / end_time are local wall-clock values in the parent shop timezone.
create table weekly_schedule (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  barber_id uuid not null references barbers (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time),
  unique (barber_id, weekday)
);

create index weekly_schedule_shop_id_idx on weekly_schedule (shop_id);

-- A blocked range, or a whole local day (all_day), for one barber. Instants are UTC.
create table blocks (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  barber_id uuid not null references barbers (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index blocks_shop_id_idx on blocks (shop_id);
create index blocks_barber_range_idx on blocks (shop_id, barber_id, starts_at);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  barber_id uuid not null references barbers (id),
  service_id uuid not null references services (id),
  customer_name text not null,
  customer_phone text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- The same barber slot can never be booked twice while the row is active,
-- including two requests that commit at the same time.
create unique index bookings_active_slot_uidx
  on bookings (shop_id, barber_id, starts_at)
  where status = 'active';

create index bookings_shop_id_idx on bookings (shop_id);

create table owner_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references shops (id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);
