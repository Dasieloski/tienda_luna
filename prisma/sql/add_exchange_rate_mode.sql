-- Ejecutar en Supabase → SQL Editor (o: npx prisma db push desde tu PC con DIRECT_URL).
-- Agrega columna exchangeRateMode y exchangeRateAutoUpdatedAt a Store.

DO $$ BEGIN
  CREATE TYPE "ExchangeRateMode" AS ENUM ('MANUAL', 'AUTO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "exchangeRateMode" "ExchangeRateMode" NOT NULL DEFAULT 'AUTO';
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "exchangeRateAutoUpdatedAt" TIMESTAMPTZ;
