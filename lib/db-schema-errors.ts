/** Postgres undefined_column / Prisma cuando falta una columna en la BD. */
export function isMissingDbColumnError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("42703")) return true;
  if (msg.includes("does not exist")) return true;
  return false;
}
