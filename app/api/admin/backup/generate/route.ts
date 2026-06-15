import { NextResponse } from "next/server";
import * as JSZipModule from "jszip";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JSZip: any = (JSZipModule as any).default || JSZipModule;

async function getTableNames(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name != '_prisma_migrations'
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getModelDelegate(name: string): any {
  const accessor = name[0].toLowerCase() + name.slice(1);
  return (prisma as unknown as Record<string, unknown>)[accessor];
}

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  try {
    const tableNames = await getTableNames();

    const data: Record<string, unknown[]> = {};
    let totalRecords = 0;

    for (const tableName of tableNames) {
      try {
        const delegate = getModelDelegate(tableName);
        if (delegate && typeof (delegate as Record<string, unknown>).findMany === "function") {
          const rows = await (delegate as { findMany: () => Promise<unknown[]> }).findMany();
          data[tableName] = rows;
          totalRecords += rows.length;
        } else {
          data[tableName] = [];
        }
      } catch {
        data[tableName] = [];
      }
    }

    const metadata = {
      appName: "tienda-luna",
      version: "0.1.0",
      createdAt: new Date().toISOString(),
      generatedBy: guard.user.email,
      generatedByUserId: guard.user.id,
      storeId: guard.session.storeId,
      totalTables: tableNames.length,
      totalRecords,
    };

    const zip = new JSZip();
    zip.file("metadata.json", JSON.stringify(metadata, null, 2));
    zip.file("data.json", JSON.stringify(data, null, 2));
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const filename = `backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}.zip`;

    try {
      await prisma.auditLog.create({
        data: {
          storeId: guard.session.storeId,
          actorType: "USER",
          actorId: guard.user.id,
          action: "BACKUP_GENERATE",
          entityType: "System",
          meta: {
            filename,
            totalRecords,
            totalTables: tableNames.length,
            generatedBy: guard.user.email,
          },
        },
      });
    } catch {
      // Log no crítico
    }

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[backup/generate] Error:", err);
    return NextResponse.json(
      { error: "Error al generar el backup.", detail: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 },
    );
  }
}
