import type { PrismaClient } from "@prisma/client";

type ProductDb = Pick<PrismaClient, "product">;

/**
 * SKU único por tienda (prefijo AUTO + sufijo). Usado en alta cuando el cliente no envía SKU.
 */
export async function allocateProductSku(db: ProductDb, storeId: string): Promise<string> {
  for (let attempt = 0; attempt < 16; attempt++) {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
    const sku = `AUTO-${suffix}`.slice(0, 240);
    const exists = await db.product.findFirst({
      where: { storeId, sku },
      select: { id: true },
    });
    if (!exists) return sku;
  }
  throw new Error("SKU_ALLOC_FAILED");
}
