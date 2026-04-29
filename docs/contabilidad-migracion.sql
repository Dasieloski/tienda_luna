-- Contabilidad Profesional (Tienda Luna)
-- Migración propuesta (segura, solo agrega columnas/tablas).
-- Ejecutar en Supabase (Postgres) y luego correr `prisma generate`.

-- 1) Periodificación de gastos: mes de impacto contable
ALTER TABLE "Expense"
  ADD COLUMN IF NOT EXISTS "impactMonth" text;

CREATE INDEX IF NOT EXISTS "Expense_storeId_impactMonth_idx"
  ON "Expense" ("storeId", "impactMonth");

-- 2) Sub-ledger contable (asientos manuales/ajustes)
CREATE TABLE IF NOT EXISTS "AccountingEntry" (
  id text PRIMARY KEY,
  "storeId" text NOT NULL,
  "postedAt" timestamptz NOT NULL,
  "impactMonth" text,
  "entryType" text NOT NULL,
  "amountCents" integer NOT NULL,
  currency text NOT NULL DEFAULT 'CUP',
  "originalAmount" integer,
  "usdRateCup" integer,
  description text NOT NULL,
  notes text,
  "relatedExpenseId" text,
  "relatedSaleId" text,
  "createdByUserId" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

-- Índices para reportes
CREATE INDEX IF NOT EXISTS "AccountingEntry_storeId_postedAt_idx"
  ON "AccountingEntry" ("storeId", "postedAt");

CREATE INDEX IF NOT EXISTS "AccountingEntry_storeId_impactMonth_idx"
  ON "AccountingEntry" ("storeId", "impactMonth");

CREATE INDEX IF NOT EXISTS "AccountingEntry_storeId_entryType_postedAt_idx"
  ON "AccountingEntry" ("storeId", "entryType", "postedAt");

-- FK suave opcional (si quieres enforcement, descomenta; por defecto lo dejamos sin FK para no bloquear despliegues)
-- ALTER TABLE "AccountingEntry"
--   ADD CONSTRAINT "AccountingEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"(id) ON DELETE CASCADE;

-- Triggers de updatedAt (si ya tienes uno global, omite esto)
-- CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
-- BEGIN
--   NEW."updatedAt" = now();
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
--
-- DROP TRIGGER IF EXISTS set_updated_at_accounting_entry ON "AccountingEntry";
-- CREATE TRIGGER set_updated_at_accounting_entry
-- BEFORE UPDATE ON "AccountingEntry"
-- FOR EACH ROW EXECUTE FUNCTION set_updated_at();

