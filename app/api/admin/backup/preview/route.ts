import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AdmZipMod: any = await import("adm-zip");
    const AdmZipCtor = AdmZipMod.default ?? AdmZipMod;
    const zip = new AdmZipCtor(buffer);

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
  } catch (err) {
    console.error("[backup/preview] Error:", err);
    return NextResponse.json(
      { error: "Error al analizar el backup.", detail: err instanceof Error ? err.message : "Error desconocido" },
      { status: 500 },
    );
  }
}
