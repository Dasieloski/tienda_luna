import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

function getPublicEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return { url, key };
}

/** Cliente navegador con cookies de auth alineadas al servidor (@supabase/ssr). */
export function createSupabaseBrowserClient(): SupabaseClient {
  const { url, key } = getPublicEnv();
  return createBrowserClient(url, key);
}

/** @deprecated Usa `createSupabaseBrowserClient` (mismo comportamiento). */
export function getSupabaseBrowserClient(): SupabaseClient {
  return createSupabaseBrowserClient();
}
