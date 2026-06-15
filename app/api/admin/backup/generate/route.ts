import { NextResponse } from "next/server";
import { createRequire } from "node:module";
import { Prisma } from "@prisma/client";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";

const require = createRequire(import.meta.url);
const archiver = require("archiver");

const EXCLUDED_TABLES = new Set(["_prisma_migrations"]);

function getModelNames(): string[] {
  return Prisma.dmmf.datamodel.models
    .map((m) => m.name)
    .filter((n) => !EXCLUDED_TABLES.has(n));
}

export async function POST(request: Request) {
  const guard = await requireAdminRequest(request, { csrf: true });
  if (!guard.ok) return guard.res;

  const modelNames = getModelNames();

  const data: Record<string, unknown[]> = {};
  let totalRecords = 0;

  for (const name of modelNames) {
    try {
      const rows = await (
        prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>
      )[name[0].toLowerCase() + name.slice(1)].findMany();
      data[name] = rows;
      totalRecords += rows.length;
    } catch {
      data[name] = [];
    }
  }

  const metadata = {
    appName: "tienda-luna",
    version: "0.1.0",
    createdAt: new Date().toISOString(),
    generatedBy: guard.user.email,
    generatedByUserId: guard.user.id,
    storeId: guard.session.storeId,
    totalTables: modelNames.length,
    totalRecords,
  };

  const chunks: Buffer[] = [];

  const archive = archiver("zip", { zlib: { level: 9 } });

  const zipPromise = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  archive.append(JSON.stringify(metadata, null, 2), { name: "metadata.json" });
  archive.append(JSON.stringify(data, null, 2), { name: "data.json" });
  archive.finalize();

  const zipBuffer = await zipPromise;

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
          totalTables: modelNames.length,
          generatedBy: guard.user.email,
        },
      },
    });
  } catch {
    // Log non-crítico
  }

  return new NextResponse(new Uint8Array(zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
