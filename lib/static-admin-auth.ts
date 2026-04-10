/**
 * Login admin temporal (sin BD). Cambiar aquí o vía env cuando toque.
 */
export const STATIC_ADMIN_EMAIL = "admin@tienda-luna.local";
export const STATIC_ADMIN_PASSWORD = "admin123";

/**
 * Marcador cuando no hay tienda en BD o Prisma no responde.
 * No puede ser cadena vacía: el JWT lo rechazaría y el middleware te devolvería al login.
 */
export const LOCAL_ADMIN_STORE_ID = "__local_sin_bd__";

export function matchesStaticAdmin(email: string, password: string): boolean {
  const envEmail = process.env.STATIC_ADMIN_EMAIL?.trim().toLowerCase();
  const envPass = process.env.STATIC_ADMIN_PASSWORD;
  const e = (envEmail || STATIC_ADMIN_EMAIL).toLowerCase();
  const p = envPass ?? STATIC_ADMIN_PASSWORD;
  return email.trim().toLowerCase() === e && password === p;
}
