import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazily-initialized singleton. Deferring the env var check to first use
// (rather than throwing at module load) means a missing SUPABASE_URL/
// SUPABASE_SERVICE_ROLE_KEY only breaks the specific request that actually
// needs the database, not the whole build/type-check — this file gets
// imported transitively by lib/storage.ts, which every page pulls in.
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되어 있지 않습니다. " +
        ".env.local(로컬) 또는 Vercel 프로젝트 환경변수(배포)를 확인하세요."
    );
  }

  // The service role key bypasses Row Level Security entirely — this must
  // never be sent to the browser. It's only ever read here, in server-only
  // code (see the "server-only" import above, which makes bundling this
  // module into a Client Component a build-time error).
  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
