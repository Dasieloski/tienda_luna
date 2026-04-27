-- Ejecutar en Supabase → SQL Editor.
-- Migra "Consumo de dueños" a modo deuda: PENDING_PAYMENT → PAID (y al pagar genera una Sale normal).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OwnerSaleStatus') THEN
    CREATE TYPE "OwnerSaleStatus" AS ENUM ('PENDING_PAYMENT', 'PAID');
  END IF;
END $$;

ALTER TABLE "OwnerSale"
  ADD COLUMN IF NOT EXISTS "status" "OwnerSaleStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  ADD COLUMN IF NOT EXISTS "paidAt" timestamptz NULL,
  ADD COLUMN IF NOT EXISTS "paidSaleId" text NULL;

-- Si venías de una versión anterior que guardaba "unitPriceCents" (precio de venta),
-- preservamos la columna antigua si existe, pero el sistema usará unitCostCents.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'OwnerSaleLine' AND column_name = 'unitCostCents'
  ) THEN
    ALTER TABLE "OwnerSaleLine" ADD COLUMN "unitCostCents" integer NULL;
  END IF;
END $$;

-- Backfill: si existe unitPriceCents y unitCostCents está vacío, copiamos (mejor que NULL).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'OwnerSaleLine' AND column_name = 'unitPriceCents'
  ) THEN
    EXECUTE 'UPDATE "OwnerSaleLine" SET "unitCostCents" = COALESCE("unitCostCents", "unitPriceCents")';
  END IF;
END $$;

-- Asegurar NOT NULL (si aún hay NULL, se ponen 0).
UPDATE "OwnerSaleLine" SET "unitCostCents" = 0 WHERE "unitCostCents" IS NULL;
ALTER TABLE "OwnerSaleLine" ALTER COLUMN "unitCostCents" SET NOT NULL;

-- Indexes útiles para historial.
CREATE INDEX IF NOT EXISTS "OwnerSale_storeId_status_createdAt_idx"
  ON "OwnerSale" ("storeId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "OwnerSale_storeId_paidAt_idx"
  ON "OwnerSale" ("storeId", "paidAt");

