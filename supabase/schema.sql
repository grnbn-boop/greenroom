-- ============================================================
-- GREENROOM — Supabase Schema
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- Enable PostGIS for geo queries (available on all Supabase projects)
create extension if not exists postgis;

-- ============================================================
-- VENUES
-- Seeded from OSM or created manually by admins
-- ============================================================
create table if not exists venues (
  id            uuid primary key default gen_random_uuid(),
  osm_id        bigint unique,               -- OpenStreetMap node/way ID (null = manually added)
  name          text not null,
  type          text not null default 'bar', -- bar | club | theatre | festival | arts_centre
  address       text,
  city          text,
  country       text default 'CA',
  capacity      int,
  lat           double precision not null,
  lng           double precision not null,
  location      geography(point, 4326),      -- PostGIS point for geo queries
  website       text,
  phone         text,
  osm_tags      jsonb,                       -- raw OSM tags for reference
  added_by      uuid references auth.users(id),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Index for geo searches
create index if not exists venues_location_idx on venues using gist(location);
create index if not exists venues_city_idx on venues(lower(city));
create index if not exists venues_osm_id_idx on venues(osm_id);

-- Auto-update location from lat/lng
create or replace function sync_venue_location()
returns trigger language plpgsql as $$
begin
  new.location = st_makepoint(new.lng, new.lat)::geography;
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_sync_venue_location
  before insert or update of lat, lng on venues
  for each row execute function sync_venue_location();

-- ============================================================
-- PROFILES
-- Extended user data beyond auth.users
-- ============================================================
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  artist_name   text,
  bio           text,
  website       text,
  is_admin      boolean default false,
  created_at    timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger trg_new_user
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- REVIEWS
-- Always pending until approved by admin
-- ============================================================
create type review_status as enum ('pending', 'approved', 'rejected', 'more_info_needed');

create table if not exists reviews (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id) on delete cascade,
  author_id       uuid references auth.users(id) on delete set null,

  -- Show details
  artist_name     text not null,
  show_name       text,
  show_date       date not null,

  -- Review content
  body            text not null,

  -- Category ratings (1–5)
  rating_sound    smallint check (rating_sound between 1 and 5),
  rating_load_in  smallint check (rating_load_in between 1 and 5),
  rating_green_room smallint check (rating_green_room between 1 and 5),
  rating_promo    smallint check (rating_promo between 1 and 5),
  rating_pay      smallint check (rating_pay between 1 and 5),
  rating_again    smallint check (rating_again between 1 and 5),

  -- Computed overall (trigger-maintained)
  rating_overall  numeric(3,2),

  -- Payment & deal transparency
  anonymous       boolean default false,
  payment_type    text check (payment_type in ('paid', 'door_deal', 'free', 'pay_to_play')),
  deal_amount     numeric(10,2),
  stipulations    text,

  -- Moderation
  status          review_status default 'pending',
  proof_link      text,
  proof_notes     text,
  proof_image_url text,
  admin_note      text,          -- internal note from moderator
  reviewed_by     uuid references auth.users(id),
  reviewed_at     timestamptz,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists reviews_venue_id_idx on reviews(venue_id);
create index if not exists reviews_status_idx on reviews(status);
create index if not exists reviews_author_id_idx on reviews(author_id);

-- Auto-compute overall rating
create or replace function compute_overall_rating()
returns trigger language plpgsql as $$
begin
  new.rating_overall = round((
    coalesce(new.rating_sound, 0) +
    coalesce(new.rating_load_in, 0) +
    coalesce(new.rating_green_room, 0) +
    coalesce(new.rating_promo, 0) +
    coalesce(new.rating_pay, 0) +
    coalesce(new.rating_again, 0)
  )::numeric / nullif(
    (case when new.rating_sound is not null then 1 else 0 end +
     case when new.rating_load_in is not null then 1 else 0 end +
     case when new.rating_green_room is not null then 1 else 0 end +
     case when new.rating_promo is not null then 1 else 0 end +
     case when new.rating_pay is not null then 1 else 0 end +
     case when new.rating_again is not null then 1 else 0 end), 0
  ), 2);
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_compute_overall
  before insert or update of rating_sound, rating_load_in, rating_green_room,
                              rating_promo, rating_pay, rating_again on reviews
  for each row execute function compute_overall_rating();

-- ============================================================
-- VENUE STATS VIEW
-- Aggregated from approved reviews — used by the frontend
-- security_invoker = true: view runs as the querying user, respecting RLS
-- (avoids SECURITY DEFINER warning from Supabase Advisor)
-- ============================================================
create or replace view venue_stats with (security_invoker = true) as
select
  v.id,
  v.name,
  v.type,
  v.address,
  v.city,
  v.capacity,
  v.lat,
  v.lng,
  v.website,
  count(r.id)                           as review_count,
  round(avg(r.rating_overall)::numeric, 2)  as avg_overall,
  round(avg(r.rating_sound)::numeric, 2)    as avg_sound,
  round(avg(r.rating_load_in)::numeric, 2)  as avg_load_in,
  round(avg(r.rating_green_room)::numeric, 2) as avg_green_room,
  round(avg(r.rating_promo)::numeric, 2)    as avg_promo,
  round(avg(r.rating_pay)::numeric, 2)      as avg_pay,
  round(avg(r.rating_again)::numeric, 2)    as avg_again
from venues v
left join reviews r on r.venue_id = v.id and r.status = 'approved'
group by v.id;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table venues enable row level security;
alter table profiles enable row level security;
alter table reviews enable row level security;

-- Note: spatial_ref_sys (PostGIS system table) cannot have RLS enabled — it is owned
-- by the extension, not the project. Dismiss this warning in Supabase Dashboard >
-- Advisors > Security rather than trying to alter the table.

-- Venues: anyone can read, only admins can insert/update/delete
create policy "venues_select_all" on venues for select using (true);

create policy "venues_insert_admin" on venues for insert
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "venues_update_admin" on venues for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

create policy "venues_delete_admin" on venues for delete
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

-- Profiles: users can read all, update their own
create policy "profiles_select_all" on profiles for select using (true);

create policy "profiles_update_own" on profiles for update
  using (auth.uid() = id);

create policy "profiles_update_admin" on profiles for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

-- Reviews: approved reviews visible to all; own pending visible to author; admins see all
create policy "reviews_select_approved" on reviews for select
  using (
    status = 'approved'
    or auth.uid() = author_id
    or exists (select 1 from profiles where id = auth.uid() and is_admin = true)
  );

create policy "reviews_insert_authenticated" on reviews for insert
  with check (auth.uid() is not null);

create policy "reviews_update_admin" on reviews for update
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

-- ============================================================
-- SAMPLE DATA (optional — remove for production)
-- ============================================================

insert into venues (osm_id, name, type, address, city, capacity, lat, lng) values
  (123456001, 'The Horseshoe Tavern', 'bar',      '370 Queen St W', 'Toronto, ON', 350,  43.6494, -79.4003),
  (123456002, 'Lee''s Palace',        'club',     '529 Bloor St W', 'Toronto, ON', 500,  43.6649, -79.4105),
  (123456003, 'Danforth Music Hall',  'theatre',  '147 Danforth Ave','Toronto, ON', 1400, 43.6782, -79.3599),
  (123456004, 'The Rex Hotel',        'bar',      '194 Queen St W', 'Toronto, ON', 120,  43.6499, -79.3896),
  (123456005, 'HISTORY',              'theatre',  '1663 Queen St E', 'Toronto, ON', 2500, 43.6638, -79.3237),
  (123456006, 'Monarch Tavern',       'bar',      '12 Clinton St',  'Toronto, ON', 200,  43.6557, -79.4112)
on conflict (osm_id) do nothing;
