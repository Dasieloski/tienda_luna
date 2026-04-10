import { PrismaClient } from "@prisma/client";

const dbUrl = process.env.DATABASE_URL ?? "";
if (dbUrl.startsWith("prisma+") || dbUrl.startsWith("prisma://")) {
  console.error(
    "[tienda-luna] DATABASE_URL usa Prisma Data Proxy / Prisma Postgres (prisma+ / prisma://). " +
      "Para Supabase necesitas postgresql://… en .env. " +
      "Si ya lo tienes en .env pero sigue fallando, borra DATABASE_URL de las variables de entorno de Windows " +
      "o reinicia tras añadir instrumentation.ts (override del .env).",
  );
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
