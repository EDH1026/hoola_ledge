-- v2.26 — add 'loveletter' (러브레터) and 'skullking' (스컬킹) to the
-- game_type enum (PRD §38). Run once against the live Supabase DB:
--   1. Open the Supabase dashboard for the `BackRoom` project
--      (https://idmnlbltfzegokencwgh.supabase.co).
--   2. Go to SQL Editor → New query.
--   3. Paste this file and click "Run".
--   4. Re-running it is safe — `if not exists` skips values already added.
--
-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction as a
-- statement that uses the new value, but each statement below is fine on
-- its own (Supabase's SQL editor runs statements individually here).

alter type game_type add value if not exists 'loveletter';
alter type game_type add value if not exists 'skullking';
