import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

function getPublicEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  return { url, key };
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** Úsalo en Server Components / Route Handlers cuando puedas leer cookies con `await cookies()`. */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  return createSupabaseServerClientWithCookieStore(await cookies());
}

/**
 * Útil si ya tienes el store (p. ej. tests) o quieres tipar el resultado de `await cookies()`.
 */
export function createSupabaseServerClientWithCookieStore(
  cookieStore: CookieStore
): SupabaseClient {
  const { url, key } = getPublicEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Llamada desde un Server Component sin poder mutar cookies; el middleware puede refrescar la sesión.
        }
      },
    },
  });
}
