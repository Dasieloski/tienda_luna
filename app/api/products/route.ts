import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { loadCatalogProducts } from "@/lib/catalog-products";
import { allocateProductSku } from "@/lib/product-sku";
import { prisma } from "@/lib/db";
import { isMissingDbColumnError } from "@/lib/db-schema-errors";

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
  /**
   * Precio de compra al proveedor (CUP, céntimos por unidad).
   * En panel suele ser obligatorio, pero la APK legacy puede no enviarlo → guardamos NULL.
   */
  costCents: z.number().int().nonnegative().nullable().optional(),
  /**
   * Proveedor del nomenclador (id). Preferido.
   * Compat APK legacy: permite `supplierName` y el servidor resuelve/crea.
   */
  supplierId: z.string().min(1).optional(),
  supplierName: z.string().max(120).optional(),
  stockQty: z.number().int().nonnegative().default(0),
  lowStockAt: z.number().int().nonnegative().optional(),
  /** Compat: algunos clientes envían `active`, pero el servidor controla el alta. */
  active: z.boolean().optional(),
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
  let sku: string;
  try {
    sku = skuTrim.length > 0 ? skuTrim : await allocateProductSku(prisma, session.storeId);
  } catch {
    return NextResponse.json({ error: "SKU_ALLOC_FAILED" }, { status: 503 });
  }

  const supplierIdRaw = parsed.data.supplierId?.trim() ?? "";
  const supplierNameRaw = parsed.data.supplierName?.trim() ?? "";
  const supplier = supplierIdRaw
    ? await prisma.supplier.findFirst({
        where: { id: supplierIdRaw, storeId: session.storeId, active: true },
      })
    : supplierNameRaw
      ? await prisma.supplier.findFirst({
          where: { storeId: session.storeId, name: { equals: supplierNameRaw, mode: "insensitive" } },
        })
      : null;

  let supplierIdResolved: string | null = supplier?.id ?? null;
  let supplierNameResolved: string | null = supplier?.name ?? null;

  if (!supplierIdResolved && supplierNameRaw) {
    // Si la APK manda supplierName pero no existe, lo creamos para no bloquear el alta.
    // (En panel, normalmente se usa supplierId del nomenclador.)
    const created = await prisma.supplier.create({
      data: {
        storeId: session.storeId,
        name: supplierNameRaw.slice(0, 120),
        active: true,
      },
      select: { id: true, name: true },
    });
    supplierIdResolved = created.id;
    supplierNameResolved = created.name;
  }

  if (!supplierIdResolved) {
    return NextResponse.json(
      { error: "INVALID_SUPPLIER", hint: "Envía supplierId o supplierName." },
      { status: 400 },
    );
  }

  try {
    const hasUsdCol = await hasProductColumn("priceUsdCents");
    const supports = {
      priceUsdCents: hasUsdCol,
      unitsPerBox: await hasProductColumn("unitsPerBox"),
      wholesaleCupCents: await hasProductColumn("wholesaleCupCents"),
      costCents: await hasProductColumn("costCents"),
      supplierId: await hasProductColumn("supplierId"),
      supplierName: await hasProductColumn("supplierName"),
    };

    /** Prisma create solo con columnas que existen en BD (evita 42703 en esquemas parciales). */
    if (hasUsdCol) {
      const data: Prisma.ProductUncheckedCreateInput = {
        storeId: session.storeId,
        sku,
        name: parsed.data.name,
        priceCents: parsed.data.priceCents,
        stockQty: parsed.data.stockQty,
        lowStockAt: parsed.data.lowStockAt ?? 5,
        active: true,
      };
      if (supports.priceUsdCents) data.priceUsdCents = parsed.data.priceUsdCents;
      if (supports.unitsPerBox) data.unitsPerBox = parsed.data.unitsPerBox;
      if (supports.wholesaleCupCents) data.wholesaleCupCents = parsed.data.wholesaleCupCents ?? null;
      if (supports.costCents) data.costCents = parsed.data.costCents ?? null;
      if (supports.supplierId) {
        data.supplierId = supplierIdResolved;
        if (supports.supplierName) data.supplierName = supplierNameResolved;
      } else if (supports.supplierName) {
        data.supplierName = supplierNameResolved;
      }

      const created = await prisma.product.create({ data });
      try {
        await prisma.auditLog.create({
          data: {
            storeId: session.storeId,
            actorType: "USER",
            actorId: session.sub,
            action: "PRODUCT_CREATE",
            entityType: "Product",
            entityId: created.id,
            after: {
              sku: created.sku,
              name: created.name,
              priceCents: created.priceCents,
              priceUsdCents: (created as any).priceUsdCents ?? 0,
              unitsPerBox: (created as any).unitsPerBox ?? 1,
              wholesaleCupCents: (created as any).wholesaleCupCents ?? null,
              costCents: (created as any).costCents ?? null,
              supplierId: (created as any).supplierId ?? null,
              supplierName: (created as any).supplierName ?? null,
              stockQty: created.stockQty,
              lowStockAt: created.lowStockAt,
              active: created.active,
            } as any,
          },
        });
      } catch (auditErr) {
        console.error("[api/products POST] auditLog (modern)", auditErr);
        return NextResponse.json({
          product: created,
          meta: { auditLogSkipped: true as const, reason: auditErr instanceof Error ? auditErr.message : "AUDIT" },
        });
      }

      return NextResponse.json({ product: created });
    }

    // Modo legacy: BD sin columnas nuevas. Insertamos solo columnas existentes y devolvemos defaults.
    const lowStockAt = parsed.data.lowStockAt ?? 5;
    const supplierName = supplierNameResolved;
    const hasCostCents = supports.costCents;
    const hasSupplierNameCol = supports.supplierName;

    const rows = hasCostCents && hasSupplierNameCol
      ? await prisma.$queryRaw<
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
    `
      : hasCostCents && !hasSupplierNameCol
        ? await prisma.$queryRaw<
            {
              id: string;
              storeId: string;
              sku: string;
              name: string;
              priceCents: number;
              costCents: number | null;
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
        "stockQty",
        "lowStockAt",
        active
      )
      VALUES (
        ${session.storeId},
        ${sku},
        ${parsed.data.name},
        ${parsed.data.priceCents},
        ${parsed.data.costCents ?? null},
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
        "stockQty",
        "lowStockAt",
        active,
        "createdAt",
        "updatedAt"
    `
        : !hasCostCents && hasSupplierNameCol
          ? await prisma.$queryRaw<
              {
                id: string;
                storeId: string;
                sku: string;
                name: string;
                priceCents: number;
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
        "supplierName",
        "stockQty",
        "lowStockAt",
        active,
        "createdAt",
        "updatedAt"
    `
          : await prisma.$queryRaw<
              {
                id: string;
                storeId: string;
                sku: string;
                name: string;
                priceCents: number;
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
        "stockQty",
        "lowStockAt",
        active
      )
      VALUES (
        ${session.storeId},
        ${sku},
        ${parsed.data.name},
        ${parsed.data.priceCents},
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

    try {
      await prisma.auditLog.create({
        data: {
          storeId: session.storeId,
          actorType: "USER",
          actorId: session.sub,
          action: "PRODUCT_CREATE",
          entityType: "Product",
          entityId: r.id,
          after: {
            sku: r.sku,
            name: r.name,
            priceCents: r.priceCents,
            priceUsdCents: 0,
            unitsPerBox: 1,
            wholesaleCupCents: null,
            costCents: "costCents" in r ? (r as { costCents: number | null }).costCents : null,
            supplierId: null,
            supplierName: "supplierName" in r ? (r as { supplierName: string | null }).supplierName : null,
            stockQty: r.stockQty,
            lowStockAt: r.lowStockAt,
            active: r.active,
          } as any,
        },
      });
    } catch (auditErr) {
      console.error("[api/products POST] auditLog legacy", auditErr);
    }

    return NextResponse.json({
      product: {
        ...r,
        priceUsdCents: 0,
        unitsPerBox: 1,
        wholesaleCupCents: null,
        costCents: "costCents" in r ? (r as { costCents: number | null }).costCents : null,
        supplierName: "supplierName" in r ? (r as { supplierName: string | null }).supplierName : null,
      },
      meta: {
        schemaLegacy: true as const,
        hint: "BD sin columnas nuevas: priceUsdCents/unitsPerBox/wholesaleCupCents quedan en default hasta migrar.",
      },
    });
  } catch (e) {
    const prismaCode =
      typeof e === "object" && e !== null && "code" in e && typeof (e as { code: unknown }).code === "string"
        ? (e as { code: string }).code
        : null;
    if (
      prismaCode === "P2002" ||
      (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    ) {
      const meta = typeof e === "object" && e !== null && "meta" in e ? (e as { meta?: { target?: unknown } }).meta : undefined;
      return NextResponse.json({ error: "DUPLICATE_SKU", meta: { target: meta?.target } }, { status: 409 });
    }
    if (prismaCode === "P2003" || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003")) {
      return NextResponse.json(
        { error: "INVALID_REFERENCE", message: "FK: revisa proveedor asociado o migración de esquema." },
        { status: 400 },
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/products POST]", e);
    if (isMissingDbColumnError(e)) {
      return NextResponse.json(
        {
          error: "DATABASE_SCHEMA_MISMATCH",
          message: msg,
          hint: "La BD no coincide con el esquema esperado. Ejecuta migraciones / prisma db push.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "PRODUCT_CREATE_FAILED", message: msg },
      { status: 500 },
    );
  }
}
