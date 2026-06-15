import { NextResponse } from "next/server";
import { createRequire } from "node:module";
import { requireAdminRequest } from "@/lib/admin-auth";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AdmZipCtor = require("adm-zip");
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type AdmZip = InstanceType<typeof AdmZipCtor>;

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

  let zip: AdmZip;
  try {
    zip = new AdmZipCtor(buffer) as AdmZip;
  } catch {
    return NextResponse.json({ error: "El archivo no es un ZIP válido o está corrupto." }, { status: 400 });
  }

  const metadataEntry = zip.getEntry("metadata.json");
  const dataEntry = zip.getEntry("data.json");

  if (!metadataEntry || !dataEntry) {
    return NextResponse.json({
      error: "El backup no contiene la estructura esperada (metadata.json + data.json).",
    }, { status: 400 });
  }

  let metadata: Record<string, unknown>;
  let data: Record<string, unknown[]>;
  try {
    metadata = JSON.parse(metadataEntry.getData().toString("utf-8"));
    data = JSON.parse(dataEntry.getData().toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "El backup contiene JSON corrupto o ilegible." }, { status: 400 });
  }

  if (!metadata.appName || !metadata.createdAt) {
    return NextResponse.json({ error: "El backup no contiene los metadatos requeridos." }, { status: 400 });
  }

  const recordCounts: Record<string, number> = {};
  let totalRecords = 0;
  for (const [table, records] of Object.entries(data)) {
    if (Array.isArray(records)) {
      recordCounts[table] = records.length;
      totalRecords += records.length;
    }
  }

  return NextResponse.json({
    metadata: {
      appName: metadata.appName,
      version: metadata.version,
      createdAt: metadata.createdAt,
      generatedBy: metadata.generatedBy,
      totalTables: metadata.totalTables,
      totalRecords: metadata.totalRecords,
    },
    recordCounts,
    computedTotalRecords: totalRecords,
    tableList: Object.keys(recordCounts).sort(),
  });
}
