-- Ejecutar en Supabase → SQL Editor (o: npx prisma db push desde tu PC con DIRECT_URL).
-- Alinea "Store" con prisma/schema.prisma para guardar el cambio CUP/USD.

ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "usdRateCup" INTEGER;
UPDATE "Store" SET "usdRateCup" = 250 WHERE "usdRateCup" IS NULL;
