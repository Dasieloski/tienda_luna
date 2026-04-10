import "./env-load";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { signDeviceSession } from "../lib/jwt";

const prisma = new PrismaClient();

async function main() {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 16) {
    throw new Error("Define JWT_SECRET (>=16 chars) en .env antes del seed");
  }

  await prisma.saleLine.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.event.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany();
  await prisma.store.deleteMany();

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
        costCents: 800,
        stockQty: 100,
        lowStockAt: 10,
      },
      {
        storeId: store.id,
        sku: "SKU-002",
        name: "Producto B",
        priceCents: 3200,
        costCents: 1900,
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

  const deviceJwt = await signDeviceSession(device.id, store.id);

  console.log("\n--- Tienda Luna seed ---");
  console.log("storeId:", store.id);
  console.log("Admin: admin@tienda-luna.local / admin123");
  console.log("Cajero: cajero@tienda-luna.local / caja123");
  console.log("Device id (deviceId en sync):", device.id);
  console.log("Token dispositivo (plain, fallback bcrypt):", deviceTokenPlain);
  console.log("JWT dispositivo (recomendado en Authorization):");
  console.log(deviceJwt);
  console.log("------------------------\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
