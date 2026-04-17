import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { loadCatalogProducts } from "@/lib/catalog-products";
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
  const includeInactiveParam =
    url.searchParams.get("includeInactive") === "1" ||
    url.searchParams.get("includeInactive")?.toLowerCase() === "true";
  /** Dispositivos (APK) necesitan el catálogo completo con `active` para sincronizar y reactivar; el POS filtra en cliente. */
  const wantInactive =
    session.typ === "device" ||
    (session.typ === "user" && includeInactiveParam);

  const products = await loadCatalogProducts(prisma, session.storeId, {
    includeInactive: wantInactive,
  });
  return NextResponse.json({ products });
}

const createSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  priceUsdCents: z.number().int().nonnegative().default(0),
  unitsPerBox: z.number().int().positive().default(1),
  wholesaleCupCents: z.number().int().nonnegative().optional().nullable(),
  costCents: z.number().int().nonnegative().optional(),
  supplierName: z.string().max(120).optional().nullable(),
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

  try {
    const hasUsd = await hasProductColumn("priceUsdCents");
    if (hasUsd) {
      const p = await prisma.product.create({
        data: {
          storeId: session.storeId,
          sku: parsed.data.sku,
          name: parsed.data.name,
          priceCents: parsed.data.priceCents,
          priceUsdCents: parsed.data.priceUsdCents,
          unitsPerBox: parsed.data.unitsPerBox,
          wholesaleCupCents: parsed.data.wholesaleCupCents ?? null,
          costCents: parsed.data.costCents,
          supplierName: parsed.data.supplierName?.trim() || null,
          stockQty: parsed.data.stockQty,
          lowStockAt: parsed.data.lowStockAt ?? 5,
        },
      });
      return NextResponse.json({ product: p });
    }

    // Modo legacy: BD sin columnas nuevas. Insertamos solo columnas existentes y devolvemos defaults.
    const lowStockAt = parsed.data.lowStockAt ?? 5;
    const supplierName = parsed.data.supplierName?.trim() || null;
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
        ${parsed.data.sku},
        ${parsed.data.name},
        ${parsed.data.priceCents},
        ${parsed.data.costCents ?? null},
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
