import "./env-load";
import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await hash("Dasieltorres@99", 10);

  // User requiere storeId. Usamos la primera tienda existente; si no hay, creamos una.
  const store =
    (await prisma.store.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } })) ??
    (await prisma.store.create({ data: { name: "Tienda", slug: "default" }, select: { id: true } }));

  await prisma.user.upsert({
    where: { email: "dasieltorres99@gmail.com" },
    create: {
      email: "dasieltorres99@gmail.com",
      passwordHash,
      role: "ADMIN",
      storeId: store.id,
    },
    update: {
      passwordHash,
      role: "ADMIN",
      storeId: store.id,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
