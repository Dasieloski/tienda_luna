/**
 * Reglas de stock aplicadas en servidor durante el batch (`lib/event-processor.ts`).
 * La app offline solo propone cantidades; el backend recorta al disponible.
 */
export function fulfillableQuantity(requested: number, available: number): number {
  if (requested <= 0) return 0;
  return Math.min(requested, Math.max(0, available));
}

export function applyDelta(current: number, delta: number): { next: number; allowed: boolean } {
  const next = current - delta;
  if (next < 0) return { next: current, allowed: false };
  return { next, allowed: true };
}
