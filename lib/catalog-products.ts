import type { PrismaClient, Product } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { isMissingDbColumnError } from "@/lib/db-schema-errors";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Lista productos activos de la tienda. Si Postgres aún no tiene las columnas
 * nuevas del modelo (`priceUsdCents`, etc.), usa un SELECT compatible y rellena defaults.
 */
export async function loadCatalogProducts(db: Db, storeId: string): Promise<Product[]> {
  try {
    return await db.product.findMany({
      where: { storeId, active: true },
      orderBy: { name: "asc" },
    });
  } catch (e) {
    if (!isMissingDbColumnError(e)) throw e;
    const legacy = await db.$queryRaw<
      {
        id: string;
        storeId: string;
        sku: string;
        name: string;
        priceCents: number;
        costCents: number | null;
        supplierName: string | null;
        stockQty: number;
        lowStockAt: number;
        active: boolean;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      SELECT
        id,
        "storeId",
        sku,
        name,
        "priceCents",
        "costCents",
        "supplierName",
        "stockQty",
        "lowStockAt",
        active,
        "createdAt",
        "updatedAt"
      FROM "Product"
      WHERE "storeId" = ${storeId}
        AND active = true
      ORDER BY name ASC
    `;
    return legacy.map(
      (r): Product => ({
        ...r,
        priceUsdCents: 0,
        unitsPerBox: 1,
        wholesaleCupCents: null,
      }),
    );
  }
}
