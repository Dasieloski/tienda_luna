import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { auditRequestMeta } from "@/lib/audit-meta";

const bodySchema = z.object({
  owner: z.enum(["OSMAR", "ALEX"]),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(120),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  if (guard.session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "NO_DB" }, { status: 503 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const storeId = guard.session.storeId;
  const owner = parsed.data.owner;
  const lines = parsed.data.lines;

  // Agrupar por producto (por si el UI añade dos veces el mismo)
  const byProduct = new Map<string, number>();
  for (const l of lines) {
    byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.quantity);
  }
  const compact = Array.from(byProduct.entries()).map(([productId, quantity]) => ({ productId, quantity }));

  try {
    const out = await prisma.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { storeId, id: { in: compact.map((c) => c.productId) }, active: true, deletedAt: null },
        select: { id: true, name: true, sku: true, stockQty: true, costCents: true },
      });
      const pById = new Map(products.map((p) => [p.id, p]));

      const missing: string[] = [];
      const insufficient: { productId: string; name: string; requested: number; stock: number }[] = [];
      const missingCost: { productId: string; name: string; sku: string }[] = [];

      for (const c of compact) {
        const p = pById.get(c.productId);
        if (!p) {
          missing.push(c.productId);
          continue;
        }
        if (p.stockQty < c.quantity) {
          insufficient.push({
            productId: p.id,
            name: p.name,
            requested: c.quantity,
            stock: p.stockQty,
          });
        }
        if (p.costCents == null) {
          missingCost.push({ productId: p.id, name: p.name, sku: p.sku });
        }
      }

      if (missing.length > 0) {
        return { ok: false as const, code: "MISSING_PRODUCTS" as const, missing };
      }
      if (insufficient.length > 0) {
        return { ok: false as const, code: "INSUFFICIENT_STOCK" as const, insufficient };
      }
      if (missingCost.length > 0) {
        return { ok: false as const, code: "MISSING_COST" as const, missingCost };
      }

      let totalCents = 0;
      const saleLines = compact.map((c) => {
        const p = pById.get(c.productId)!;
        const unitCostCents = p.costCents!;
        const subtotalCents = unitCostCents * c.quantity;
        totalCents += subtotalCents;
        return {
          productId: p.id,
          productName: p.name,
          productSku: p.sku,
          quantity: c.quantity,
          unitCostCents,
          subtotalCents,
        };
      });

      // Actualizar stock y dejar trazabilidad
      for (const c of compact) {
        const p = pById.get(c.productId)!;
        const before = p.stockQty;
        const after = before - c.quantity;
        await tx.product.update({ where: { id: p.id }, data: { stockQty: after } });
        await (tx.inventoryMovement as any).create({
          data: {
            storeId,
            productId: p.id,
            productName: p.name,
            productSku: p.sku,
            delta: -c.quantity,
            beforeQty: before,
            afterQty: after,
            reason: "OWNER_SALE",
            actorType: "USER",
            actorId: guard.session.sub,
          },
        });
      }

      const created = await (tx as any).ownerSale.create({
        data: {
          storeId,
          owner,
          totalCents,
          status: "PENDING_PAYMENT",
          lines: { create: saleLines },
        },
        select: { id: true, owner: true, totalCents: true, createdAt: true, lines: { select: { id: true } } },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          actorType: "USER",
          actorId: guard.session.sub,
          action: "OWNER_SALE_CREATE",
          entityType: "OwnerSale",
          entityId: created.id,
          after: {
            owner,
            totalCents,
            status: "PENDING_PAYMENT",
            lines: saleLines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitCostCents: l.unitCostCents,
              subtotalCents: l.subtotalCents,
            })),
          } as any,
          meta: auditRequestMeta(request) as any,
        },
      });

      return { ok: true as const, created };
    });

    if (!out.ok) {
      if (out.code === "MISSING_PRODUCTS") {
        return NextResponse.json({ error: out.code, missing: out.missing }, { status: 400 });
      }
      if (out.code === "INSUFFICIENT_STOCK") {
        return NextResponse.json({ error: out.code, insufficient: out.insufficient }, { status: 409 });
      }
      if (out.code === "MISSING_COST") {
        return NextResponse.json({ error: out.code, missingCost: out.missingCost }, { status: 409 });
      }
      return NextResponse.json({ error: "UNKNOWN" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      ownerSale: {
        id: out.created.id,
        owner: out.created.owner,
        totalCents: out.created.totalCents,
        createdAt: out.created.createdAt.toISOString(),
        lineCount: out.created.lines.length,
      },
    });
  } catch (err) {
    console.error("[api/admin/owner-sales/create]", err);
    return NextResponse.json({ error: "DB" }, { status: 500 });
  }
}

