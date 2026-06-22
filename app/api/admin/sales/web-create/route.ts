import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { resolveSaleLineUnitPriceCupCents } from "@/lib/pricing";
import { upsertDailySnapshot } from "@/services/snapshot-service";

const bodySchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1),
        unitPriceCupCentsOverride: z.number().int().min(1).optional(),
      }),
    )
    .min(1)
    .max(400),
  paymentMethod: z.string().trim().default("cash"),
  paidAmountCents: z.number().int().min(0).optional(),
});

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const { lines, paymentMethod, paidAmountCents } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const storeId = guard.session.storeId;
      const userEmail = guard.user.email;

      const pids = lines.map((l) => l.productId);
      const products = await tx.product.findMany({
        where: { id: { in: pids }, storeId },
        select: {
          id: true,
          name: true,
          sku: true,
          priceCents: true,
          transferPriceCents: true,
          costCents: true,
          stockQty: true,
        },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));

      const lineDrafts: {
        productId: string;
        productName: string;
        sku: string;
        quantity: number;
        unitPriceCents: number;
        subtotalCents: number;
        unitCostCents: number | null;
        subtotalCostCents: number | null;
      }[] = [];

      for (const line of lines) {
        const product = productMap.get(line.productId);
        if (!product) {
          throw new Error(`PRODUCT_NOT_FOUND:${line.productId}`);
        }
        if (product.stockQty < line.quantity) {
          throw new Error(`INSUFFICIENT_STOCK:${product.name}`);
        }

        const unitPriceCents = resolveSaleLineUnitPriceCupCents(
          line.unitPriceCupCentsOverride,
          product.priceCents,
        );
        const subtotalCents = line.quantity * unitPriceCents;
        const unitCostCents = product.costCents ?? null;
        const subtotalCostCents =
          unitCostCents != null ? line.quantity * unitCostCents : null;

        lineDrafts.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          quantity: line.quantity,
          unitPriceCents,
          subtotalCents,
          unitCostCents,
          subtotalCostCents,
        });
      }

      const totalCents = lineDrafts.reduce(
        (sum, l) => sum + l.subtotalCents,
        0,
      );
      const paid = paidAmountCents != null ? paidAmountCents : totalCents;
      const balance = totalCents - paid;
      const paymentStatus = balance <= 0 ? "PAID" : "PARTIAL";

      const sale = await tx.sale.create({
        data: {
          storeId,
          deviceId: "WEB_ADMIN",
          soldBy: userEmail,
          totalCents,
          paidTotalCents: paid,
          balanceCents: Math.max(0, balance),
          paymentStatus,
          status: "COMPLETED",
          completedAt: new Date(),
          lines: {
            create: lineDrafts.map((l) => ({
              productId: l.productId,
              productName: l.productName,
              productSku: l.sku,
              quantity: l.quantity,
              unitPriceCents: l.unitPriceCents,
              subtotalCents: l.subtotalCents,
              unitCostCents: l.unitCostCents,
              subtotalCostCents: l.subtotalCostCents,
            })),
          },
        },
        include: { lines: true },
      });

      if (paid > 0) {
        await tx.salePayment.create({
          data: {
            storeId,
            saleId: sale.id,
            amountCupCents: paid,
            currency: "CUP",
            method: paymentMethod,
            paidAt: new Date(),
          },
        });
      }

      for (const draft of lineDrafts) {
        const product = productMap.get(draft.productId)!;
        const beforeQty = product.stockQty;
        const afterQty = beforeQty - draft.quantity;

        await tx.product.update({
          where: { id: draft.productId },
          data: { stockQty: afterQty },
        });

        await tx.inventoryMovement.create({
          data: {
            storeId,
            productId: draft.productId,
            productName: draft.productName,
            productSku: draft.sku,
            delta: -draft.quantity,
            beforeQty,
            afterQty,
            reason: "WEB_SALE",
            actorType: "USER",
            actorId: guard.user.id,
          },
        });
      }

      await upsertDailySnapshot(storeId, new Date());

      return { saleId: sale.id, totalCents };
    });

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "UNKNOWN";
    if (message.startsWith("PRODUCT_NOT_FOUND:")) {
      const pid = message.slice("PRODUCT_NOT_FOUND:".length);
      return NextResponse.json(
        { error: `Producto no encontrado: ${pid}` },
        { status: 400 },
      );
    }
    if (message.startsWith("INSUFFICIENT_STOCK:")) {
      const name = message.slice("INSUFFICIENT_STOCK:".length);
      return NextResponse.json(
        { error: `Stock insuficiente: ${name}` },
        { status: 400 },
      );
    }
    console.error("[api/admin/sales/web-create]", e);
    return NextResponse.json(
      { error: "Error interno al crear la venta" },
      { status: 500 },
    );
  }
}
