import { loadCatalogProducts } from "@/lib/catalog-products";
import { prisma } from "@/lib/db";

export async function validateSaleLines(
  storeId: string,
  lines: { productId: string; quantity: number }[],
) {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const catalog = await loadCatalogProducts(prisma, storeId);
  const products = catalog.filter((p) => ids.includes(p.id));
  const byId = new Map(products.map((p) => [p.id, p]));

  const shortages: {
    productId: string;
    solicitado: number;
    disponible: number;
    faltante: number;
  }[] = [];

  let valid = true;
  const suggested: { productId: string; quantity: number; unitPriceCents: number }[] = [];

  for (const line of lines) {
    const p = byId.get(line.productId);
    if (!p) {
      valid = false;
      shortages.push({
        productId: line.productId,
        solicitado: line.quantity,
        disponible: 0,
        faltante: line.quantity,
      });
      continue;
    }
    const disponible = p.stockQty;
    const cumplir = Math.min(line.quantity, Math.max(0, disponible));
    if (cumplir < line.quantity) {
      valid = false;
      shortages.push({
        productId: line.productId,
        solicitado: line.quantity,
        disponible,
        faltante: line.quantity - cumplir,
      });
    }
    if (cumplir > 0) {
      suggested.push({
        productId: line.productId,
        quantity: cumplir,
        unitPriceCents: p.priceCents,
      });
    }
  }

  const totalCents = suggested.reduce((a, l) => a + l.quantity * l.unitPriceCents, 0);

  return { valid, shortages, suggestedLines: suggested, totalCents };
}
