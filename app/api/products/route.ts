import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { loadCatalogProducts } from "@/lib/catalog-products";
import { allocateProductSku } from "@/lib/product-sku";
import { prisma } from "@/lib/db";

async function hasProductColumn(columnName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ ok: number }[]>`
    SELECT 1::int AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Product'
      AND column_name = ${columnName}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  /** Catálogo para tablet (JWT de dispositivo) o panel (usuario cajero/admin). */
  const canReadCatalog =
    session.typ === "device" ||
    (session.typ === "user" && (session.role === "ADMIN" || session.role === "CASHIER"));

  if (!canReadCatalog) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const url = new URL(request.url);
  const includeDeleted =
    session.typ === "user" &&
    session.role === "ADMIN" &&
    (url.searchParams.get("includeDeleted") === "1" ||
      url.searchParams.get("includeDeleted")?.toLowerCase() === "true");

  /**
   * Catálogo con activos + inactivos (`active`). Los eliminados (`deletedAt`) solo en admin con ?includeDeleted=1.
   * Dispositivos/APK: sin eliminados; en venta filtrar `active && !deletedAt` en cliente.
   */
  const products = await loadCatalogProducts(prisma, session.storeId, {
    includeInactive: true,
    includeDeleted,
  });
  return NextResponse.json({ products });
}

const createSchema = z.object({
  /** Opcional: si falta o va vacío, el servidor genera un SKU único (AUTO-…). */
  sku: z.string().max(240).optional().nullable(),
  name: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  priceUsdCents: z.number().int().nonnegative().default(0),
  unitsPerBox: z.number().int().positive().default(1),
  wholesaleCupCents: z.number().int().nonnegative().optional().nullable(),
  /** Precio de compra al proveedor (CUP, céntimos por unidad). Obligatorio en alta. */
  costCents: z.number().int().nonnegative(),
  /** Proveedor del nomenclador (obligatorio en alta desde panel). */
  supplierId: z.string().cuid(),
  stockQty: z.number().int().nonnegative().default(0),
  lowStockAt: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const skuTrim = parsed.data.sku?.trim() ?? "";
  let sku = skuTrim.length > 0 ? skuTrim : await allocateProductSku(prisma, session.storeId);

  const supplier = await prisma.supplier.findFirst({
    where: {
      id: parsed.data.supplierId,
      storeId: session.storeId,
      active: true,
    },
  });
  if (!supplier) {
    return NextResponse.json({ error: "INVALID_SUPPLIER" }, { status: 400 });
  }
  const supplierNameResolved = supplier.name;

  try {
    const hasUsd = await hasProductColumn("priceUsdCents");
    const hasSupplierIdCol = await hasProductColumn("supplierId");
    if (hasUsd) {
      const p = await prisma.product.create({
        data: {
          storeId: session.storeId,
          sku,
          name: parsed.data.name,
          priceCents: parsed.data.priceCents,
          priceUsdCents: parsed.data.priceUsdCents,
          unitsPerBox: parsed.data.unitsPerBox,
          wholesaleCupCents: parsed.data.wholesaleCupCents ?? null,
          costCents: parsed.data.costCents,
          ...(hasSupplierIdCol
            ? { supplierId: supplier.id, supplierName: supplierNameResolved }
            : { supplierName: supplierNameResolved }),
          stockQty: parsed.data.stockQty,
          lowStockAt: parsed.data.lowStockAt ?? 5,
        },
      });
      await prisma.auditLog.create({
        data: {
          storeId: session.storeId,
          actorType: "USER",
          actorId: session.sub,
          action: "PRODUCT_CREATE",
          entityType: "Product",
          entityId: p.id,
          after: {
            sku: p.sku,
            name: p.name,
            priceCents: p.priceCents,
            priceUsdCents: (p as any).priceUsdCents ?? 0,
            unitsPerBox: (p as any).unitsPerBox ?? 1,
            wholesaleCupCents: (p as any).wholesaleCupCents ?? null,
            costCents: (p as any).costCents ?? null,
            supplierId: (p as any).supplierId ?? null,
            supplierName: (p as any).supplierName ?? null,
            stockQty: p.stockQty,
            lowStockAt: p.lowStockAt,
            active: p.active,
          } as any,
        },
      });
      return NextResponse.json({ product: p });
    }

    // Modo legacy: BD sin columnas nuevas. Insertamos solo columnas existentes y devolvemos defaults.
    const lowStockAt = parsed.data.lowStockAt ?? 5;
    const supplierName = supplierNameResolved;
    const rows = await prisma.$queryRaw<
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
      INSERT INTO "Product" (
        "storeId",
        sku,
        name,
        "priceCents",
        "costCents",
        "supplierName",
        "stockQty",
        "lowStockAt",
        active
      )
      VALUES (
        ${session.storeId},
        ${sku},
        ${parsed.data.name},
        ${parsed.data.priceCents},
        ${parsed.data.costCents},
        ${supplierName},
        ${parsed.data.stockQty},
        ${lowStockAt},
        true
      )
      RETURNING
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
    `;
    const r = rows[0];
    if (!r) {
      return NextResponse.json({ error: "DB_INSERT_FAILED" }, { status: 500 });
    }
    return NextResponse.json({
      product: {
        ...r,
        priceUsdCents: 0,
        unitsPerBox: 1,
        wholesaleCupCents: null,
      },
      meta: {
        schemaLegacy: true as const,
        hint: "BD sin columnas nuevas: priceUsdCents/unitsPerBox/wholesaleCupCents quedan en default hasta migrar.",
      },
    });
  } catch {
    return NextResponse.json({ error: "DUPLICATE_SKU_OR_DB" }, { status: 409 });
  }
}
