-- hoola_ledge v2.11 — Supabase (Postgres) schema.
--
-- How to run this:
--   1. Open the Supabase dashboard for the `BackRoom` project
--      (https://idmnlbltfzegokencwgh.supabase.co).
--   2. Go to SQL Editor → New query.
--   3. Paste this entire file and click "Run".
--   4. Re-running it is NOT safe (every `create table`/`create type` will
--      fail on a second run because the objects already exist) — this is a
--      one-time setup script, not a repeatable migration. If you need to
--      change the schema later, write a new, separate ALTER script.
--
-- No Supabase CLI / local Postgres is used for this project — the app has no
-- other database tooling, and a single hand-run SQL file keeps that true
-- (see AGENTS.md: keep the stack simple, few dependencies).

create extension if not exists "pgcrypto";

create table participants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create type game_type as enum ('hoola', 'citadels', '6nimmt');

create table games (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  time time,                        -- nullable: legacy records predate this field
  game_type game_type,              -- nullable: legacy records predate this field -> "미지정" in the UI
  points integer not null default 1,
  active boolean not null default true,
  attendee_ids uuid[] not null,     -- intentionally no FK constraint on array elements
  winner_id uuid not null references participants(id),
  loser_id uuid not null references participants(id),
  note text,
  created_at timestamptz not null default now()
);
create index games_date_idx on games(date);
create index games_active_idx on games(active);
create index games_created_at_idx on games(created_at);

create type settlement_type as enum ('payment', 'donation');

create table settlements (
  id uuid primary key default gen_random_uuid(),
  type settlement_type not null default 'payment',
  from_id uuid not null references participants(id),
  to_id uuid not null references participants(id),
  amount integer not null check (amount > 0),
  date date not null,
  note text,
  created_at timestamptz not null default now()
);
create index settlements_created_at_idx on settlements(created_at);

create table adjustments (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references participants(id),
  to_id uuid not null references participants(id),
  amount integer not null check (amount > 0),
  note text,
  date date not null,
  created_at timestamptz not null default now()
);
create index adjustments_created_at_idx on adjustments(created_at);

alter table participants enable row level security;
alter table games enable row level security;
alter table settlements enable row level security;
alter table adjustments enable row level security;
-- No policies are created on purpose — this locks every table to anon/
-- authenticated roles entirely. The app only ever talks to Supabase from
-- server-side code (Server Actions / Server Components) using the service
-- role key, which bypasses RLS by design. There is no client-side Supabase
-- access anywhere in this app, so there's nothing for a policy to protect
-- against — access control lives at the app layer (SITE_PASSWORD /
-- ADMIN_PASSWORD in src/proxy.ts and src/lib/admin.ts), exactly as it did
-- before this migration.

-- Admin rollback (see src/lib/actions.ts: previewRollback/executeRollback)
-- deletes matching rows from three tables in one shot. Wrapping it in a
-- single plpgsql function makes the whole thing one Postgres transaction —
-- either all three deletes happen or none do, so a rollback can never leave
-- games deleted but settlements untouched. Called from the app via
-- `supabase.rpc('rollback_after', { cutoff })`.
create or replace function rollback_after(cutoff timestamptz)
returns table (
  games_deleted integer,
  settlements_deleted integer,
  adjustments_deleted integer
)
language plpgsql
as $$
declare
  g_count integer;
  s_count integer;
  a_count integer;
begin
  delete from games where created_at > cutoff;
  get diagnostics g_count = row_count;

  delete from settlements where created_at > cutoff;
  get diagnostics s_count = row_count;

  delete from adjustments where created_at > cutoff;
  get diagnostics a_count = row_count;

  return query select g_count, s_count, a_count;
end;
$$;
