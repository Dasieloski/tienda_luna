import type { PrismaClient, Product } from "@prisma/client";
import { Prisma } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

async function hasColumn(db: Db, columnName: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ ok: number }[]>`
    SELECT 1::int AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = ${columnName}
    LIMIT 1
  `;
  return rows.length > 0;
}

export type LoadCatalogOptions = {
  /** Si es true, incluye productos con active=false. */
  includeInactive?: boolean;
  /** Solo admin: incluye filas con deletedAt (papelera de inventario). */
  includeDeleted?: boolean;
};

/**
 * Lista productos de la tienda.
 * Por defecto excluye borrados lógicos (deletedAt). Sin includeInactive, solo activos (POS).
 */
export async function loadCatalogProducts(
  db: Db,
  storeId: string,
  opts?: LoadCatalogOptions,
): Promise<Product[]> {
  const activeOnly = opts?.includeInactive !== true;
  const includeDeleted = opts?.includeDeleted === true;

  const hasUsd = await hasColumn(db, "priceUsdCents");
  const hasDeletedAt = await hasColumn(db, "deletedAt");

  if (hasUsd) {
    return await db.product.findMany({
      where: {
        storeId,
        ...(activeOnly ? { active: true } : {}),
        ...(includeDeleted ? {} : hasDeletedAt ? { deletedAt: null } : {}),
      },
      orderBy: { name: "asc" },
    });
  }

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
    ${activeOnly ? Prisma.sql` AND active = true` : Prisma.empty}
    ${
      !includeDeleted && hasDeletedAt
        ? Prisma.sql` AND "deletedAt" IS NULL`
        : Prisma.empty
    }
    ORDER BY name ASC
  `;
  return legacy.map(
    (r): Product => ({
      ...r,
      priceUsdCents: 0,
      unitsPerBox: 1,
      wholesaleCupCents: null,
      deletedAt: null,
    }),
  );
}
