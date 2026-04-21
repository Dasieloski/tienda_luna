/**
 * Marcador cuando no hay tienda en BD o Prisma no responde.
 * No puede ser cadena vacía: el JWT lo rechazaría y el middleware te devolvería al login.
 */
export const LOCAL_ADMIN_STORE_ID = "__local_sin_bd__";
