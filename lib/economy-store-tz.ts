/** Misma convención que economía/calendario: minutos a sumar a UTC para obtener “hora local tienda”. */
export function storeTzOffsetMinutes() {
  const raw = process.env.TL_TZ_OFFSET_MINUTES ?? process.env.NEXT_PUBLIC_TL_TZ_OFFSET_MINUTES;
  const v = raw == null ? -240 : Number(raw); // default Cuba (UTC-4)
  return Number.isFinite(v) ? v : -240;
}

export function storeTzOffsetIntervalSql() {
  return `${storeTzOffsetMinutes()} minutes`;
}
