import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

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
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "NO_DB" }, { status: 503 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const storeId = session.storeId;
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
        select: { id: true, name: true, sku: true, stockQty: true, priceCents: true },
      });
      const pById = new Map(products.map((p) => [p.id, p]));

      const missing: string[] = [];
      const insufficient: { productId: string; name: string; requested: number; stock: number }[] = [];

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
      }

      if (missing.length > 0) {
        return { ok: false as const, code: "MISSING_PRODUCTS" as const, missing };
      }
      if (insufficient.length > 0) {
        return { ok: false as const, code: "INSUFFICIENT_STOCK" as const, insufficient };
      }

      let totalCents = 0;
      const saleLines = compact.map((c) => {
        const p = pById.get(c.productId)!;
        const unitPriceCents = p.priceCents;
        const subtotalCents = unitPriceCents * c.quantity;
        totalCents += subtotalCents;
        return {
          productId: p.id,
          productName: p.name,
          productSku: p.sku,
          quantity: c.quantity,
          unitPriceCents,
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
            actorId: session.sub,
          },
        });
      }

      const created = await (tx as any).ownerSale.create({
        data: {
          storeId,
          owner,
          totalCents,
          lines: { create: saleLines },
        },
        select: { id: true, owner: true, totalCents: true, createdAt: true, lines: { select: { id: true } } },
      });

      await tx.auditLog.create({
        data: {
          storeId,
          actorType: "USER",
          actorId: session.sub,
          action: "OWNER_SALE_CREATE",
          entityType: "OwnerSale",
          entityId: created.id,
          after: {
            owner,
            totalCents,
            lines: saleLines.map((l) => ({ productId: l.productId, quantity: l.quantity, subtotalCents: l.subtotalCents })),
          } as any,
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

