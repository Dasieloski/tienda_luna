-- Ejecutar en Supabase → SQL Editor (o usar `npx prisma db push` desde tu PC).
-- Crea tablas para "Consumo de dueños" (deuda): descuenta stock, no cuenta como ingreso/ganancia hasta que se pague.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OwnerName') THEN
    CREATE TYPE "OwnerName" AS ENUM ('OSMAR', 'ALEX');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OwnerSaleStatus') THEN
    CREATE TYPE "OwnerSaleStatus" AS ENUM ('PENDING_PAYMENT', 'PAID');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "OwnerSale" (
  id text PRIMARY KEY,
  "storeId" text NOT NULL REFERENCES "Store"(id) ON DELETE CASCADE,
  owner "OwnerName" NOT NULL,
  "totalCents" integer NOT NULL DEFAULT 0,
  status "OwnerSaleStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "paidAt" timestamptz NULL,
  "paidSaleId" text NULL
);

CREATE TABLE IF NOT EXISTS "OwnerSaleLine" (
  id text PRIMARY KEY,
  "ownerSaleId" text NOT NULL REFERENCES "OwnerSale"(id) ON DELETE CASCADE,
  "productId" text NOT NULL REFERENCES "Product"(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  "unitCostCents" integer NOT NULL,
  "subtotalCents" integer NOT NULL
);

CREATE INDEX IF NOT EXISTS "OwnerSale_storeId_createdAt_idx"
  ON "OwnerSale" ("storeId", "createdAt");

CREATE INDEX IF NOT EXISTS "OwnerSale_storeId_owner_createdAt_idx"
  ON "OwnerSale" ("storeId", owner, "createdAt");

CREATE INDEX IF NOT EXISTS "OwnerSale_storeId_status_createdAt_idx"
  ON "OwnerSale" ("storeId", status, "createdAt");

CREATE INDEX IF NOT EXISTS "OwnerSale_storeId_paidAt_idx"
  ON "OwnerSale" ("storeId", "paidAt");

CREATE INDEX IF NOT EXISTS "OwnerSaleLine_ownerSaleId_idx"
  ON "OwnerSaleLine" ("ownerSaleId");

CREATE INDEX IF NOT EXISTS "OwnerSaleLine_productId_idx"
  ON "OwnerSaleLine" ("productId");

