import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/admin-auth";
import { isMissingDbColumnError } from "@/lib/db-schema-errors";
import { prisma } from "@/lib/db";
import { getClientIp, rateLimitOrThrow } from "@/lib/rate-limit";
import { auditRequestMeta } from "@/lib/audit-meta";

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

const patchSchema = z
  .object({
    sku: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    priceCents: z.number().int().nonnegative().optional(),
    priceUsdCents: z.number().int().nonnegative().optional(),
    unitsPerBox: z.number().int().positive().optional(),
    wholesaleCupCents: z.number().int().nonnegative().nullable().optional(),
    costCents: z.number().int().nonnegative().nullable().optional(),
    supplierId: z.string().cuid().nullable().optional(),
    supplierName: z.string().max(120).nullable().optional(),
    stockQty: z.number().int().nonnegative().optional(),
    lowStockAt: z.number().int().nonnegative().optional(),
    active: z.boolean().optional(),
    /** Solo para restaurar producto archivado (admin). */
    restore: z.literal(true).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "EMPTY" });

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: RouteCtx) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const existing = await prisma.product.findFirst({
    where: { id, storeId: guard.session.storeId },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const data = parsed.data;
  if (data.supplierName !== undefined) {
    data.supplierName = data.supplierName?.trim() || null;
  }

  let supplierNameFromId: string | null | undefined;
  if (data.supplierId !== undefined) {
    if (data.supplierId === null) {
      supplierNameFromId = null;
    } else {
      const sup = await prisma.supplier.findFirst({
        where: { id: data.supplierId, storeId: guard.session.storeId },
      });
      if (!sup) {
        return NextResponse.json({ error: "INVALID_SUPPLIER" }, { status: 400 });
      }
      const sameAsCurrent = existing.supplierId === sup.id;
      if (!sup.active && !sameAsCurrent) {
        return NextResponse.json({ error: "INVALID_SUPPLIER" }, { status: 400 });
      }
      supplierNameFromId = sup.name;
    }
  }

  const restoring = data.restore === true && existing.deletedAt != null;
  const nextStockQty = data.stockQty !== undefined ? data.stockQty : existing.stockQty;
  const stockChanged = data.stockQty !== undefined && data.stockQty !== existing.stockQty;
  if (stockChanged) {
    const ip = getClientIp(request);
    const rl = rateLimitOrThrow({
      key: `manualAdjust:${guard.session.storeId}:${guard.session.sub}:${ip}`,
      max: 12,
      windowMs: 10 * 60_000,
      blockMs: 15 * 60_000,
    });
    if (!rl.ok) {
      return NextResponse.json({ error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec }, { status: 429 });
    }
    // Step-up: si el token indica MFA requerido pero no está presente, bloquear ajustes manuales.
    if (guard.session.mfaRequired === true && guard.session.mfa !== true) {
      return NextResponse.json({ error: "MFA_REQUIRED" }, { status: 401 });
    }
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          ...(restoring ? { deletedAt: null } : {}),
          ...(data.sku !== undefined ? { sku: data.sku } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.priceCents !== undefined ? { priceCents: data.priceCents } : {}),
          ...(data.priceUsdCents !== undefined ? { priceUsdCents: data.priceUsdCents } : {}),
          ...(data.unitsPerBox !== undefined ? { unitsPerBox: data.unitsPerBox } : {}),
          ...(data.wholesaleCupCents !== undefined ? { wholesaleCupCents: data.wholesaleCupCents } : {}),
          ...(data.costCents !== undefined ? { costCents: data.costCents } : {}),
          ...(data.supplierId !== undefined
            ? { supplierId: data.supplierId, supplierName: supplierNameFromId ?? null }
            : {}),
          ...(data.supplierName !== undefined && data.supplierId === undefined
            ? { supplierName: data.supplierName }
            : {}),
          ...(data.stockQty !== undefined ? { stockQty: data.stockQty } : {}),
          ...(data.lowStockAt !== undefined ? { lowStockAt: data.lowStockAt } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
        },
      });

      if (stockChanged) {
        await tx.inventoryMovement.create({
          data: {
            storeId: guard.session.storeId,
            productId: updated.id,
            delta: nextStockQty - existing.stockQty,
            beforeQty: existing.stockQty,
            afterQty: nextStockQty,
            reason: "MANUAL_ADJUST",
            actorType: "USER",
            actorId: guard.session.sub,
            eventId: null,
          },
        });
      }

      const before = {
        sku: existing.sku,
        name: existing.name,
        priceCents: existing.priceCents,
        priceUsdCents: (existing as any).priceUsdCents ?? 0,
        unitsPerBox: (existing as any).unitsPerBox ?? 1,
        wholesaleCupCents: (existing as any).wholesaleCupCents ?? null,
        costCents: (existing as any).costCents ?? null,
        supplierId: (existing as any).supplierId ?? null,
        supplierName: (existing as any).supplierName ?? null,
        stockQty: existing.stockQty,
        lowStockAt: existing.lowStockAt,
        active: existing.active,
        deletedAt: (existing as any).deletedAt ?? null,
      };
      const after = {
        sku: updated.sku,
        name: updated.name,
        priceCents: updated.priceCents,
        priceUsdCents: (updated as any).priceUsdCents ?? 0,
        unitsPerBox: (updated as any).unitsPerBox ?? 1,
        wholesaleCupCents: (updated as any).wholesaleCupCents ?? null,
        costCents: (updated as any).costCents ?? null,
        supplierId: (updated as any).supplierId ?? null,
        supplierName: (updated as any).supplierName ?? null,
        stockQty: updated.stockQty,
        lowStockAt: updated.lowStockAt,
        active: updated.active,
        deletedAt: (updated as any).deletedAt ?? null,
      };
      const changedKeys = Object.keys(after).filter(
        (k) => (after as any)[k] !== (before as any)[k],
      );

      await tx.auditLog.create({
        data: {
          storeId: guard.session.storeId,
          actorType: "USER",
          actorId: guard.session.sub,
          action: restoring ? "PRODUCT_RESTORE" : stockChanged ? "PRODUCT_UPDATE_STOCK" : "PRODUCT_UPDATE",
          entityType: "Product",
          entityId: updated.id,
          before: before as any,
          after: after as any,
          meta: { changedKeys, ...auditRequestMeta(request) } as any,
        },
      });

      return updated;
    });

    return NextResponse.json({ product });
  } catch (e) {
    if (isMissingDbColumnError(e)) {
      // Modo legacy: BD sin columnas nuevas (priceUsdCents/unitsPerBox/wholesaleCupCents/supplierId/deletedAt/etc).
      // Aplicamos el patch solo sobre columnas existentes para no bloquear el panel.
      try {
        const supports = {
          priceUsdCents: await hasProductColumn("priceUsdCents"),
          unitsPerBox: await hasProductColumn("unitsPerBox"),
          wholesaleCupCents: await hasProductColumn("wholesaleCupCents"),
          costCents: await hasProductColumn("costCents"),
          supplierId: await hasProductColumn("supplierId"),
          supplierName: await hasProductColumn("supplierName"),
          deletedAt: await hasProductColumn("deletedAt"),
        };

        const setParts: string[] = [];
        const params: any[] = [];
        let p = 1;
        const pushSet = (sqlFrag: string, value: any) => {
          setParts.push(sqlFrag.replace("?", `$${p}`));
          params.push(value);
          p += 1;
        };

        if (restoring && supports.deletedAt) {
          setParts.push(`"deletedAt" = NULL`);
        }
        if (data.sku !== undefined) pushSet(`sku = ?`, data.sku);
        if (data.name !== undefined) pushSet(`name = ?`, data.name);
        if (data.priceCents !== undefined) pushSet(`"priceCents" = ?`, data.priceCents);
        if (data.priceUsdCents !== undefined && supports.priceUsdCents)
          pushSet(`"priceUsdCents" = ?`, data.priceUsdCents);
        if (data.unitsPerBox !== undefined && supports.unitsPerBox)
          pushSet(`"unitsPerBox" = ?`, data.unitsPerBox);
        if (data.wholesaleCupCents !== undefined && supports.wholesaleCupCents)
          pushSet(`"wholesaleCupCents" = ?`, data.wholesaleCupCents);
        if (data.costCents !== undefined && supports.costCents) pushSet(`"costCents" = ?`, data.costCents);

        // supplierId solo si existe columna; si no, permitimos supplierName (si existe) para no romper UI.
        if (data.supplierId !== undefined && supports.supplierId) {
          pushSet(`"supplierId" = ?`, data.supplierId);
          if (supports.supplierName) pushSet(`"supplierName" = ?`, supplierNameFromId ?? null);
        } else if (data.supplierName !== undefined && supports.supplierName) {
          pushSet(`"supplierName" = ?`, data.supplierName);
        }

        if (data.stockQty !== undefined) pushSet(`"stockQty" = ?`, data.stockQty);
        if (data.lowStockAt !== undefined) pushSet(`"lowStockAt" = ?`, data.lowStockAt);
        if (data.active !== undefined) pushSet(`active = ?`, data.active);

        if (setParts.length === 0) {
          return NextResponse.json(
            {
              error: "DATABASE_SCHEMA_MISMATCH",
              hint: "La BD es legacy y el cambio que intentas hacer requiere columnas que aún no existen. Migra la BD o edita solo campos básicos (sku, nombre, CUP, stock, activo).",
            },
            { status: 409 },
          );
        }

        // Condición final: producto debe pertenecer a la tienda del admin.
        const whereStoreId = guard.session.storeId;
        const idParam = id;
        const sql = `
          UPDATE "Product"
          SET ${setParts.join(", ")}, "updatedAt" = NOW()
          WHERE id = $${p} AND "storeId" = $${p + 1}
          RETURNING *
        `;
        params.push(idParam, whereStoreId);
        const rows = (await prisma.$queryRawUnsafe<any[]>(sql, ...params)) ?? [];
        const updated = rows[0];
        if (!updated) {
          return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
        }

        // Si cambió stock y existe tabla de movimientos, intentamos registrar; si falla, no bloquea.
        if (stockChanged) {
          try {
            await prisma.inventoryMovement.create({
              data: {
                storeId: guard.session.storeId,
                productId: updated.id,
                delta: nextStockQty - existing.stockQty,
                beforeQty: existing.stockQty,
                afterQty: nextStockQty,
                reason: "MANUAL_ADJUST",
                actorType: "USER",
                actorId: guard.session.sub,
                eventId: null,
              },
            });
          } catch {
            // ignore en legacy parcial
          }
        }

        // Auditoría best-effort
        try {
          await prisma.auditLog.create({
            data: {
              storeId: guard.session.storeId,
              actorType: "USER",
              actorId: guard.session.sub,
              action: restoring
                ? "PRODUCT_RESTORE"
                : stockChanged
                  ? "PRODUCT_UPDATE_STOCK"
                  : "PRODUCT_UPDATE",
              entityType: "Product",
              entityId: updated.id,
              before: { id: existing.id, sku: existing.sku, name: existing.name } as any,
              after: { id: updated.id, sku: updated.sku, name: updated.name } as any,
              meta: { schemaLegacy: true, appliedKeys: Object.keys(data) } as any,
            },
          });
        } catch {
          // ignore
        }

        return NextResponse.json({
          product: updated,
          meta: {
            schemaLegacy: true as const,
            hint: "BD legacy: PATCH aplicado solo a columnas existentes. Ejecuta prisma/sql/add_product_pricing_columns.sql (y otras migraciones) para soporte completo.",
          },
        });
      } catch (err) {
        console.error("[api/products/[id] legacy PATCH]", err);
        return NextResponse.json(
          {
            error: "DATABASE_SCHEMA_MISMATCH",
            hint: "La BD está desactualizada y no se pudo aplicar el patch en modo legacy. Ejecuta migraciones (prisma/sql/add_product_pricing_columns.sql) o npx prisma db push.",
          },
          { status: 503 },
        );
      }
    }
    return NextResponse.json({ error: "DUPLICATE_SKU_OR_DB" }, { status: 409 });
  }
}

/** Borrado lógico: conserva fila y relaciones con ventas; libera SKU para nuevos productos. */
export async function DELETE(request: Request, ctx: RouteCtx) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  }

  const existing = await prisma.product.findFirst({
    where: { id, storeId: guard.session.storeId },
  });
  if (!existing) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (existing.deletedAt) {
    return NextResponse.json({ ok: true, meta: { alreadyDeleted: true } });
  }

  const skuArchived = `__arch__${existing.id.slice(-12)}__${existing.sku}`.slice(0, 240);

  try {
    const before = {
      sku: existing.sku,
      name: existing.name,
      active: existing.active,
      deletedAt: existing.deletedAt ?? null,
    };
    const updated = await prisma.product.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        active: false,
        sku: skuArchived,
      },
    });
    const after = {
      sku: updated.sku,
      name: updated.name,
      active: updated.active,
      deletedAt: (updated as any).deletedAt ?? null,
    };
    await prisma.auditLog.create({
      data: {
        storeId: guard.session.storeId,
        actorType: "USER",
        actorId: guard.session.sub,
        action: "PRODUCT_ARCHIVE",
        entityType: "Product",
        entityId: existing.id,
        before: before as any,
        after: after as any,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isMissingDbColumnError(e)) {
      return NextResponse.json(
        {
          error: "DATABASE_SCHEMA_MISMATCH",
          hint: "Añade la columna deletedAt en Product (npx prisma db push).",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "DELETE_FAILED" }, { status: 500 });
  }
}
