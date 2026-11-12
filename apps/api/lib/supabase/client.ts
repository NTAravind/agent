import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requiredEnv } from "@/lib/env";

let client: SupabaseClient | undefined;

/**
 * Anon-key client used only to verify incoming JWTs (`auth.getUser(token)`).
 */
export function supabaseAnon(): SupabaseClient {
  if (!client) {
    client = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
