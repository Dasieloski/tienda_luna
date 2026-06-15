import { NextResponse } from "next/server";
import * as JSZipModule from "jszip";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JSZip: any = (JSZipModule as any).default || JSZipModule;

console.log("[backup/generate] JSZip module loaded. typeof JSZip:", typeof JSZip);
console.log("[backup/generate] JSZip keys:", typeof JSZip === "object" ? Object.keys(JSZip) : "N/A");
console.log("[backup/generate] JSZipModule keys:", Object.keys(JSZipModule as any));
console.log("[backup/generate] JSZipModule.default:", typeof (JSZipModule as any).default);

async function getTableNames(): Promise<string[]> {
  console.log("[backup/generate] getTableNames() start");
  const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name != '_prisma_migrations'
    ORDER BY table_name
  `;
  const names = rows.map((r) => r.table_name);
  console.log("[backup/generate] tables found:", names.length, names);
  return names;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getModelDelegate(name: string): any {
  const accessor = name[0].toLowerCase() + name.slice(1);
  console.log("[backup/generate] getModelDelegate for", name, "-> accessor:", accessor);
  return (prisma as unknown as Record<string, unknown>)[accessor];
}

export async function POST(request: Request) {
  console.log("[backup/generate] POST start");
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) {
    console.log("[backup/generate] auth failed");
    return guard.res;
  }
  console.log("[backup/generate] auth ok, user:", guard.user.email);

  try {
    const tableNames = await getTableNames();
    console.log("[backup/generate] tableNames:", tableNames);

    const data: Record<string, unknown[]> = {};
    let totalRecords = 0;

    for (const tableName of tableNames) {
      try {
        const delegate = getModelDelegate(tableName);
        console.log("[backup/generate] delegate for", tableName, "->", typeof delegate, delegate ? Object.keys(delegate as any).slice(0, 5) : "null");
        if (delegate && typeof (delegate as Record<string, unknown>).findMany === "function") {
          console.log("[backup/generate] calling findMany for", tableName);
          const rows = await (delegate as { findMany: () => Promise<unknown[]> }).findMany();
          console.log("[backup/generate]", tableName, "rows:", rows.length);
          data[tableName] = rows;
          totalRecords += rows.length;
        } else {
          console.log("[backup/generate] no findMany for", tableName);
          data[tableName] = [];
        }
      } catch (e) {
        console.error("[backup/generate] error fetching", tableName, ":", e);
        data[tableName] = [];
      }
    }

    console.log("[backup/generate] totalRecords:", totalRecords);

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
    console.log("[backup/generate] metadata created");

    console.log("[backup/generate] typeof JSZip before new:", typeof JSZip);
    if (typeof JSZip !== "function") {
      console.error("[backup/generate] JSZip is not a function!", JSZip);
      return NextResponse.json({ error: "JSZip is not a function", debug: { typeofJSZip: typeof JSZip, JSZip: JSON.stringify(JSZip) } }, { status: 500 });
    }

    const zip = new JSZip();
    console.log("[backup/generate] JSZip instance created");

    zip.file("metadata.json", JSON.stringify(metadata, null, 2));
    zip.file("data.json", JSON.stringify(data, null, 2));
    console.log("[backup/generate] files added to zip");

    console.log("[backup/generate] calling generateAsync...");
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    console.log("[backup/generate] zipBuffer generated, size:", zipBuffer.length);

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
    } catch (e) {
      console.error("[backup/generate] auditLog error:", e);
    }

    console.log("[backup/generate] returning response, filename:", filename);
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[backup/generate] FATAL ERROR:", err);
    return NextResponse.json(
      { error: "Error al generar el backup.", detail: err instanceof Error ? err.message : "Error desconocido", stack: err instanceof Error ? err.stack : null },
      { status: 500 },
    );
  }
}
