const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const fromArg = process.argv[2] ?? null; // YYYY-MM-DD
    const toArg = process.argv[3] ?? null; // YYYY-MM-DD
    const from = fromArg ? new Date(fromArg + "T00:00:00.000Z") : null;
    const toExclusive = toArg ? new Date(new Date(toArg + "T00:00:00.000Z").getTime() + 24 * 60 * 60 * 1000) : null;

    const prods = await prisma.product.findMany({
      where: { deletedAt: null, name: { contains: "Adobo", mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        sku: true,
        priceCents: true,
        costCents: true,
        unitsPerBox: true,
        stockQty: true,
        supplierId: true,
        supplierName: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    console.log("products", prods);
    if (!prods[0]) return;

    for (const p of prods) {
      const lines = await prisma.saleLine.findMany({
        where: {
          productId: p.id,
          sale: {
            status: "COMPLETED",
            ...(from && toExclusive ? { completedAt: { gte: from, lt: toExclusive } } : {}),
          },
        },
        take: 120,
        orderBy: { sale: { completedAt: "desc" } },
        select: {
          id: true,
          quantity: true,
          unitPriceCents: true,
          unitCostCents: true,
          subtotalCents: true,
          sale: { select: { completedAt: true, status: true, totalCents: true } },
        },
      });

      const profit = lines.reduce((acc, l) => {
        const cost = l.unitCostCents ?? p.costCents;
        if (cost == null) return acc;
        return acc + (l.unitPriceCents - cost) * l.quantity;
      }, 0);
      const revenueWithKnownCost = lines.reduce((acc, l) => {
        const cost = l.unitCostCents ?? p.costCents;
        if (cost == null) return acc;
        return acc + l.subtotalCents;
      }, 0);
      const marginPct = revenueWithKnownCost > 0 ? (profit / revenueWithKnownCost) * 100 : null;

      const worst = lines
        .map((l) => ({
          completedAt: l.sale.completedAt,
          qty: l.quantity,
          unitPriceCents: l.unitPriceCents,
          unitCostCents: l.unitCostCents,
          effectiveCostCents: l.unitCostCents ?? p.costCents,
          delta: l.unitPriceCents - (l.unitCostCents ?? p.costCents ?? 0),
          subtotalCents: l.subtotalCents,
        }))
        .filter((x) => x.effectiveCostCents != null)
        .sort((a, b) => a.delta - b.delta)[0];

      console.log("----");
      console.log("product", { id: p.id, name: p.name, sku: p.sku, priceCents: p.priceCents, costCents: p.costCents });
      console.log("range", { from: fromArg, to: toArg, lines: lines.length });
      console.log("calc", { profit, revenueWithKnownCost, marginPct });
      console.log("worst_line", worst ?? null);
      console.log(
        "sample",
        lines.slice(0, 8).map((l) => ({
          completedAt: l.sale.completedAt,
          qty: l.quantity,
          unitPriceCents: l.unitPriceCents,
          unitCostCents: l.unitCostCents,
          subtotalCents: l.subtotalCents,
        })),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

