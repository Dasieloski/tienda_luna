-- Permite borrar productos físicamente sin romper historial:
-- - SaleLine / InventoryMovement / OwnerSaleLine guardan snapshot (name/sku)
-- - FK a Product pasa a SET NULL y productId se vuelve nullable

ALTER TABLE "SaleLine"
  ADD COLUMN IF NOT EXISTS "productName" text,
  ADD COLUMN IF NOT EXISTS "productSku" text;

ALTER TABLE "InventoryMovement"
  ADD COLUMN IF NOT EXISTS "productName" text,
  ADD COLUMN IF NOT EXISTS "productSku" text;

ALTER TABLE "OwnerSaleLine"
  ADD COLUMN IF NOT EXISTS "productName" text,
  ADD COLUMN IF NOT EXISTS "productSku" text;

-- Backfill desde Product
UPDATE "SaleLine" sl
SET
  "productName" = COALESCE(sl."productName", p.name),
  "productSku"  = COALESCE(sl."productSku", p.sku)
FROM "Product" p
WHERE sl."productId" = p.id;

UPDATE "InventoryMovement" im
SET
  "productName" = COALESCE(im."productName", p.name),
  "productSku"  = COALESCE(im."productSku", p.sku)
FROM "Product" p
WHERE im."productId" = p.id;

UPDATE "OwnerSaleLine" ol
SET
  "productName" = COALESCE(ol."productName", p.name),
  "productSku"  = COALESCE(ol."productSku", p.sku)
FROM "Product" p
WHERE ol."productId" = p.id;

-- Asegurar NOT NULL después del backfill
ALTER TABLE "SaleLine"
  ALTER COLUMN "productName" SET NOT NULL,
  ALTER COLUMN "productSku"  SET NOT NULL;

ALTER TABLE "InventoryMovement"
  ALTER COLUMN "productName" SET NOT NULL,
  ALTER COLUMN "productSku"  SET NOT NULL;

ALTER TABLE "OwnerSaleLine"
  ALTER COLUMN "productName" SET NOT NULL,
  ALTER COLUMN "productSku"  SET NOT NULL;

-- FK -> SET NULL
ALTER TABLE "SaleLine" DROP CONSTRAINT IF EXISTS "SaleLine_productId_fkey";
ALTER TABLE "SaleLine"
  ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "SaleLine"
  ADD CONSTRAINT "SaleLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"(id) ON DELETE SET NULL;

ALTER TABLE "InventoryMovement" DROP CONSTRAINT IF EXISTS "InventoryMovement_productId_fkey";
ALTER TABLE "InventoryMovement"
  ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"(id) ON DELETE SET NULL;

ALTER TABLE "OwnerSaleLine" DROP CONSTRAINT IF EXISTS "OwnerSaleLine_productId_fkey";
ALTER TABLE "OwnerSaleLine"
  ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "OwnerSaleLine"
  ADD CONSTRAINT "OwnerSaleLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"(id) ON DELETE SET NULL;

