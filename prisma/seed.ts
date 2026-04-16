import "./env-load";
import { hash } from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { signDeviceSession } from "../lib/jwt";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function addMinutes(d: Date, minutes: number) {
  return new Date(d.getTime() + minutes * 60_000);
}

async function main() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 16) {
    throw new Error("Define JWT_SECRET (>=16 chars) en .env antes del seed");
  }

  // Reset solo la tienda demo (no borra otras tiendas si ya existen datos)
  const existingDemo = await prisma.store.findUnique({ where: { slug: "demo" }, select: { id: true } });
  if (existingDemo) {
    const storeId = existingDemo.id;
    const saleIds = await prisma.sale.findMany({ where: { storeId }, select: { id: true } });
    if (saleIds.length) {
      await prisma.saleLine.deleteMany({ where: { saleId: { in: saleIds.map((s) => s.id) } } });
    }
    const productIds = await prisma.product.findMany({ where: { storeId }, select: { id: true } });
    if (productIds.length) {
      await prisma.saleLine.deleteMany({ where: { productId: { in: productIds.map((p) => p.id) } } });
    }
    await prisma.sale.deleteMany({ where: { storeId } });
    await prisma.event.deleteMany({ where: { storeId } });
    await prisma.product.deleteMany({ where: { storeId } });
    await prisma.customer.deleteMany({ where: { storeId } });
    await prisma.device.deleteMany({ where: { storeId } });
    await prisma.user.deleteMany({ where: { storeId } });
    await prisma.store.delete({ where: { id: storeId } });
  }

  const store = await prisma.store.create({
    data: {
      name: "Tienda Demo",
      slug: "demo",
      dashboardLayout: {
        widgets: ["ventas", "stock", "fraude", "cohortes"],
      },
    },
  });

  const adminHash = await hash("admin123", 10);
  const cashierHash = await hash("caja123", 10);

  await prisma.user.createMany({
    data: [
      {
        email: "admin@tienda-luna.local",
        passwordHash: adminHash,
        role: "ADMIN",
        storeId: store.id,
      },
      {
        email: "cajero@tienda-luna.local",
        passwordHash: cashierHash,
        role: "CASHIER",
        storeId: store.id,
      },
    ],
  });

  const deviceTokenPlain = "dev-device-token";
  const deviceTokenHash = await hash(deviceTokenPlain, 10);
  const device = await prisma.device.create({
    data: {
      storeId: store.id,
      label: "Caja 1",
      tokenHash: deviceTokenHash,
    },
  });

  await prisma.product.createMany({
    data: [
      {
        storeId: store.id,
        sku: "SKU-001",
        name: "Producto A",
        priceCents: 1500,
        priceUsdCents: 6,
        unitsPerBox: 12,
        wholesaleCupCents: 1300,
        costCents: 800,
        supplierName: "Distribuciones Norte",
        stockQty: 100,
        lowStockAt: 10,
      },
      {
        storeId: store.id,
        sku: "SKU-002",
        name: "Producto B",
        priceCents: 3200,
        priceUsdCents: 13,
        unitsPerBox: 24,
        wholesaleCupCents: 2800,
        costCents: 1900,
        supplierName: "Mayorista Central",
        stockQty: 5,
        lowStockAt: 10,
      },
    ],
  });

  await prisma.customer.create({
    data: {
      storeId: store.id,
      name: "Cliente frecuente",
      phone: "+1000000000",
    },
  });

  await prisma.customer.createMany({
    data: [
      { storeId: store.id, name: "Ana Pérez", phone: "+1000000001", email: "ana@example.com" },
      { storeId: store.id, name: "Luis García", phone: "+1000000002", email: "luis@example.com" },
      { storeId: store.id, name: "María López", phone: "+1000000003", email: "maria@example.com" },
      { storeId: store.id, name: "Carlos Díaz", phone: "+1000000004" },
    ],
    skipDuplicates: true,
  });
  const customers = await prisma.customer.findMany({ where: { storeId: store.id } });

  const device2TokenPlain = "dev-device-token-2";
  const device2TokenHash = await hash(device2TokenPlain, 10);
  const device2 = await prisma.device.create({
    data: {
      storeId: store.id,
      label: "Caja 2",
      tokenHash: device2TokenHash,
      lastSeenAt: new Date(),
    },
  });

  const products = await prisma.product.findMany({ where: { storeId: store.id } });
  if (products.length < 2) {
    throw new Error("Seed: se esperaban al menos 2 productos");
  }

  const sellers = [
    "cajero@tienda-luna.local",
    "admin@tienda-luna.local",
    "Cajero turno mañana",
    "Cajero turno tarde",
  ] as const;

  // Generate realistic sales history (last 30 days)
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);

  const saleCount = 160;
  console.log(`Generando ${saleCount} ventas de prueba...`);

  type SaleSeed = {
    clientSaleId: string;
    deviceId: string;
    soldBy: string;
    customerId: string | null;
    totalCents: number;
    completedAt: Date;
    lines: { productId: string; quantity: number; unitPriceCents: number; subtotalCents: number }[];
  };

  const salesSeed: SaleSeed[] = [];
  const eventsSeed: Prisma.EventCreateManyInput[] = [];

  for (let i = 0; i < saleCount; i++) {
    const base = new Date(start.getTime() + Math.random() * (now.getTime() - start.getTime()));
    base.setHours(randInt(8, 21), randInt(0, 59), randInt(0, 59), 0);

    const chosenDevice = Math.random() < 0.68 ? device : device2;
    const soldBy = pick(sellers);
    const customer = Math.random() < 0.55 ? pick(customers) : null;
    const lineCount = randInt(1, 6);
    const lines = Array.from({ length: lineCount }, () => {
      const p = pick(products);
      const qty = randInt(1, 4);
      const unit = p.priceCents;
      return { productId: p.id, quantity: qty, unitPriceCents: unit, subtotalCents: unit * qty };
    });
    const totalCents = lines.reduce((acc, l) => acc + l.subtotalCents, 0);
    const clientSaleId = randomUUID();

    salesSeed.push({
      clientSaleId,
      deviceId: chosenDevice.id,
      soldBy,
      customerId: customer?.id ?? null,
      totalCents,
      completedAt: base,
      lines,
    });

    const payload = {
      // Usamos clientSaleId como id lógico (la proyección Sale es reconstruible)
      saleId: clientSaleId,
      clientSaleId,
      soldBy,
      deviceId: chosenDevice.id,
      completedAt: base.toISOString(),
      totalCents,
      lines,
      customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
    };

    eventsSeed.push({
      clientEventId: randomUUID(),
      type: "SALE_COMPLETED",
      payload,
      payloadHash: `${totalCents}:${lines.length}:${payload.completedAt}`,
      storeId: store.id,
      deviceId: chosenDevice.id,
      clientTimestamp: BigInt(base.getTime()),
      serverTimestamp: addMinutes(base, randInt(0, 2)),
      status: "ACCEPTED",
      relatedClientSaleId: clientSaleId,
    });
  }

  // Insert sales with limited concurrency (avoid slow sequential network roundtrips)
  // Nota: en Supabase pooler es común tener connection_limit=1 en este entorno.
  // Para evitar timeouts P2024, insertamos secuencialmente con feedback de progreso.
  for (let i = 0; i < salesSeed.length; i++) {
    const s = salesSeed[i]!;
    await prisma.sale.create({
      data: {
        storeId: store.id,
        deviceId: s.deviceId,
        soldBy: s.soldBy,
        clientSaleId: s.clientSaleId,
        customerId: s.customerId,
        totalCents: s.totalCents,
        status: "completed",
        completedAt: s.completedAt,
        lines: { create: s.lines },
      },
    });
    if ((i + 1) % 25 === 0 || i === salesSeed.length - 1) {
      console.log(`Ventas insertadas: ${i + 1}/${salesSeed.length}`);
    }
  }

  // Insert events in bulk
  await prisma.event.createMany({ data: eventsSeed, skipDuplicates: true });
  console.log("Eventos insertados:", eventsSeed.length);

  const deviceJwt = await signDeviceSession(device.id, store.id);

  console.log("\n--- Tienda Luna seed ---");
  console.log("storeId:", store.id);
  console.log("Admin: admin@tienda-luna.local / admin123");
  console.log("Cajero: cajero@tienda-luna.local / caja123");
  console.log("Device id (deviceId en sync):", device.id);
  console.log("Token dispositivo (plain, fallback bcrypt):", deviceTokenPlain);
  console.log("JWT dispositivo (recomendado en Authorization):");
  console.log(deviceJwt);
  console.log("Device2 id:", device2.id);
  console.log("Token dispositivo 2 (plain):", device2TokenPlain);
  console.log("------------------------\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
