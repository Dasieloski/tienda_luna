-- Ejecutar en Supabase → SQL Editor (o: npx prisma db push desde tu PC con DIRECT_URL).
-- Corrige: column p.priceUsdCents does not exist (42703)
-- Alinea "Product" con prisma/schema.prisma

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "priceUsdCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unitsPerBox" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "wholesaleCupCents" INTEGER;
