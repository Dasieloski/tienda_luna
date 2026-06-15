import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import AdmZip from "adm-zip";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

const INSERT_ORDER: string[] = [
  "Store",
  "User",
  "Device",
  "Customer",
  "ExpenseCategory",
  "Supplier",
  "Product",
  "Event",
  "Sale",
  "MetricSnapshot",
  "CashClosingDay",
  "DailyIncident",
  "Expense",
  "FxExchange",
  "OwnerSale",
  "AccountingEntry",
  "AuditLog",
  "CashClosingRevision",
  "CashClosingNote",
  "CashClosingFinding",
  "SaleLine",
  "SalePayment",
  "SaleReturn",
  "SupplierDebtPayment",
  "SupplierWithdrawal",
  "SaleReturnLine",
  "SupplierWithdrawalLine",
  "OwnerSaleLine",
  "InventoryMovement",
];

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  let buffer: Buffer;
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
    }
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 400 });
  }

  try {
    const zip = new AdmZip(buffer);

    const metadataEntry = zip.getEntry("metadata.json");
    const dataEntry = zip.getEntry("data.json");

    if (!metadataEntry || !dataEntry) {
      return NextResponse.json({ error: "Backup inválido: faltan metadata.json o data.json." }, { status: 400 });
    }

    let metadata: Record<string, unknown>;
    let backupData: Record<string, unknown[]>;
    try {
      metadata = JSON.parse(metadataEntry.getData().toString("utf-8"));
      backupData = JSON.parse(dataEntry.getData().toString("utf-8"));
    } catch {
      return NextResponse.json({ error: "Backup corrupto: JSON ilegible." }, { status: 400 });
    }

    if (!metadata.appName || !metadata.createdAt) {
      return NextResponse.json({ error: "Backup inválido: metadatos incompletos." }, { status: 400 });
    }

    const backupTotalRecords = Number(metadata.totalRecords) || 0;
    const restoredBy = guard.user.email;
    const restoredByUserId = guard.user.id;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        DO $$ DECLARE r RECORD; BEGIN
          FOR r IN (
            SELECT tablename FROM pg_tables
            WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
          ) LOOP
            EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP;
        END $$;
      `);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = tx as unknown as Record<string, { createMany: (args: { data: unknown[] }) => Promise<any> }>;

      for (const modelName of INSERT_ORDER) {
        const records = backupData[modelName];
        if (!records || records.length === 0) continue;

        const prismaKey = modelName[0].toLowerCase() + modelName.slice(1);
        const model = client[prismaKey];

        if (!model || typeof model.createMany !== "function") continue;

        const BATCH_SIZE = 500;
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE);
          await model.createMany({ data: batch });
        }
      }
    });

    try {
      await prisma.auditLog.create({
        data: {
          storeId: guard.session.storeId,
          actorType: "USER",
          actorId: restoredByUserId,
          action: "BACKUP_RESTORE",
          entityType: "System",
          meta: {
            backupCreatedAt: String(metadata.createdAt ?? ""),
            backupGeneratedBy: String(metadata.generatedBy ?? ""),
            backupVersion: String(metadata.version ?? ""),
            restoredBy,
            totalRecordsRestored: backupTotalRecords,
          } as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Log no crítico
    }

    return NextResponse.json({
      ok: true,
      totalRecordsRestored: backupTotalRecords,
      restoredBy,
    });
  } catch (err) {
    console.error("[backup/restore] Error:", err);
    return NextResponse.json(
      {
        error: "La restauración falló y se revirtió completamente.",
        detail: err instanceof Error ? err.message : "Error desconocido",
      },
      { status: 500 },
    );
  }
}
