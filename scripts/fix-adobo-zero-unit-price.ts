/**
 * Corrección puntual: línea de venta con unitPriceCents = 0 (Adobo → 1600 CUP).
 * Uso (desde la raíz del repo): npx tsx scripts/fix-adobo-zero-unit-price.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

config({ path: resolve(process.cwd(), ".env"), override: true });
config({ path: resolve(process.cwd(), ".env.local"), override: true });

const ADOBO_PRODUCT_ID = "cmo7hux660001l104gy2ywtw5";
const UNIT_PRICE_CENTS = 160_000; // 1600.00 CUP

function nextPaymentStatus(paidTotalCents: number, totalCents: number): string {
  if (paidTotalCents === 0) return "CREDIT_OPEN";
  const balance = totalCents - paidTotalCents;
  if (balance === 0) return "PAID";
  if (balance > 0) return "PARTIAL";
  return "OVERPAID";
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const badLines = await prisma.saleLine.findMany({
      where: {
        productId: ADOBO_PRODUCT_ID,
        unitPriceCents: 0,
        quantity: { gt: 0 },
      },
      select: { id: true, saleId: true, quantity: true },
    });

    if (badLines.length === 0) {
      console.log("No hay líneas Adobo con precio 0; nada que corregir.");
      return;
    }

    const saleIds = [...new Set(badLines.map((l) => l.saleId))];

    await prisma.$transaction(async (tx) => {
      for (const line of badLines) {
        await tx.saleLine.update({
          where: { id: line.id },
          data: {
            unitPriceCents: UNIT_PRICE_CENTS,
            subtotalCents: UNIT_PRICE_CENTS * line.quantity,
          },
        });
      }

      for (const saleId of saleIds) {
        const lines = await tx.saleLine.findMany({
          where: { saleId },
          select: { subtotalCents: true },
        });
        const totalCents = lines.reduce((s, l) => s + l.subtotalCents, 0);
        const sale = await tx.sale.findUnique({
          where: { id: saleId },
          select: { paidTotalCents: true },
        });
        if (!sale) continue;
        const balanceCents = totalCents - sale.paidTotalCents;
        await tx.sale.update({
          where: { id: saleId },
          data: {
            totalCents,
            balanceCents,
            paymentStatus: nextPaymentStatus(sale.paidTotalCents, totalCents),
          },
        });
      }
    });

    console.log(
      `Corregidas ${badLines.length} línea(s); ventas actualizadas: ${saleIds.join(", ")}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
