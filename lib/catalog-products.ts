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
  const hasTransfer = await hasColumn(db, "transferPriceCents");
  const hasDeletedAt = await hasColumn(db, "deletedAt");
  const hasSupplierId = await hasColumn(db, "supplierId");

  if (hasUsd && hasTransfer) {
    return await db.product.findMany({
      where: {
        storeId,
        ...(activeOnly ? { active: true } : {}),
        ...(includeDeleted ? {} : hasDeletedAt ? { deletedAt: null } : {}),
      },
      orderBy: { name: "asc" },
      ...(hasSupplierId
        ? { include: { supplier: { select: { id: true, name: true } } } }
        : {}),
    });
  }

  // Modo legacy/parcial: construir SELECT solo con columnas que existen.
  const cols: string[] = [
    "id",
    `"storeId"`,
    "sku",
    "name",
    `"priceCents"`,
  ];
  if (hasTransfer) cols.push(`"transferPriceCents"`);
  if (hasUsd) cols.push(`"priceUsdCents"`);
  cols.push(
    `"costCents"`,
    `"supplierName"`,
    `"stockQty"`,
    `"lowStockAt"`,
    "active",
    `"createdAt"`,
    `"updatedAt"`,
  );
  if (hasDeletedAt) cols.push(`"deletedAt"`);
  if (hasSupplierId) cols.push(`"supplierId"`);

  const whereParts: string[] = [`"storeId" = $1`];
  const params: any[] = [storeId];
  if (activeOnly) whereParts.push(`active = true`);
  if (!includeDeleted && hasDeletedAt) whereParts.push(`"deletedAt" IS NULL`);

  const sql = `
    SELECT ${cols.join(", ")}
    FROM "Product"
    WHERE ${whereParts.join(" AND ")}
    ORDER BY name ASC
  `;
  const rows = ((await db.$queryRawUnsafe<unknown[]>(sql, ...params)) ?? []) as unknown[];

  return rows.map(
    (r): Product => {
      const row = r as Record<string, unknown>;
      const priceCents = typeof row.priceCents === "number" ? row.priceCents : 0;
      const transferPriceCents =
        typeof row.transferPriceCents === "number" ? row.transferPriceCents : priceCents;
      return {
        ...(row as unknown as Product),
        priceCents,
        transferPriceCents,
        priceUsdCents: typeof row.priceUsdCents === "number" ? row.priceUsdCents : 0,
        unitsPerBox: typeof row.unitsPerBox === "number" ? row.unitsPerBox : 1,
        wholesaleCupCents: (row.wholesaleCupCents as number | null | undefined) ?? null,
        deletedAt: (row.deletedAt as Date | null | undefined) ?? null,
        supplierId: (row.supplierId as string | null | undefined) ?? null,
      };
    },
  );
}
