import Papa from "papaparse";

export type ProductExportRow = {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  transferPriceCents: number;
  priceUsdCents: number;
  costCents: number | null;
  unitsPerBox: number;
  wholesaleCupCents: number | null;
  stockQty: number;
  lowStockAt: number;
  supplierId: string | null;
  supplierName: string | null;
  active: boolean;
};

export type InventoryField =
  | "name"
  | "priceCents"
  | "transferPriceCents"
  | "priceUsdCents"
  | "costCents"
  | "unitsPerBox"
  | "wholesaleCupCents"
  | "stockQty"
  | "lowStockAt"
  | "supplierName"
  | "active";

export const INVENTORY_CSV_HEADERS = [
  "SKU",
  "Nombre",
  "Precio de venta (CUP)",
  "PVP transferencia (CUP)",
  "PVP (USD)",
  "Compra al proveedor (CUP)",
  "Ud/caja",
  "Mayorista (CUP)",
  "Stock",
  "Alerta stock",
  "Proveedor",
  "Activo",
] as const;

const HEADER_MAP: Record<string, InventoryField | "sku"> = {
  sku: "sku",
  nombre: "name",
  name: "name",
  "precio de venta (cup)": "priceCents",
  "precio_venta": "priceCents",
  "pvp efectivo": "priceCents",
  "pvp (efectivo)": "priceCents",
  pvp_transferencia: "transferPriceCents",
  "pvp transferencia": "transferPriceCents",
  "pvp (transfer)": "transferPriceCents",
  "pvp (transferencia)": "transferPriceCents",
  pvp_usd: "priceUsdCents",
  "pvp (usd)": "priceUsdCents",
  "precio usd": "priceUsdCents",
  "compra al proveedor (cup)": "costCents",
  compra: "costCents",
  "precio de compra": "costCents",
  "ud/caja": "unitsPerBox",
  ud_caja: "unitsPerBox",
  "unidades por caja": "unitsPerBox",
  "mayorista (cup)": "wholesaleCupCents",
  mayorista: "wholesaleCupCents",
  stock: "stockQty",
  "alerta stock": "lowStockAt",
  proveedor: "supplierName",
  activo: "active",
};

function centsToCsvDecimal(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function csvDecimalToCents(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function buildInventoryCsv(rows: ProductExportRow[]): string {
  const data = rows.map((r) => ({
    SKU: r.sku,
    Nombre: r.name,
    "Precio de venta (CUP)": centsToCsvDecimal(r.priceCents),
    "PVP transferencia (CUP)": centsToCsvDecimal(r.transferPriceCents),
    "PVP (USD)": centsToCsvDecimal(r.priceUsdCents),
    "Compra al proveedor (CUP)": centsToCsvDecimal(r.costCents),
    "Ud/caja": r.unitsPerBox,
    "Mayorista (CUP)": centsToCsvDecimal(r.wholesaleCupCents),
    Stock: r.stockQty,
    "Alerta stock": r.lowStockAt,
    Proveedor: r.supplierName ?? "",
    Activo: r.active ? "1" : "0",
  }));
  return Papa.unparse(data, {
    header: true,
    columns: INVENTORY_CSV_HEADERS as unknown as string[],
  });
}

export type ParsedCsvRow = {
  rowIndex: number;
  sku: string;
  values: Partial<Record<InventoryField, string>>;
};

export type ParsedCsv = {
  rows: ParsedCsvRow[];
  errors: { rowIndex: number; message: string }[];
};

export function parseInventoryCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const errors: { rowIndex: number; message: string }[] = [];
  const rows: ParsedCsvRow[] = [];

  for (let i = 0; i < result.data.length; i++) {
    const raw = result.data[i] ?? {};
    const sku = String(raw.sku ?? "").trim();
    if (!sku) {
      errors.push({ rowIndex: i + 2, message: "SKU vacío: fila ignorada." });
      continue;
    }
    const values: Partial<Record<InventoryField, string>> = {};
    for (const [key, val] of Object.entries(raw)) {
      const field = HEADER_MAP[key];
      if (!field || field === "sku" || val == null) continue;
      values[field] = String(val).trim();
    }
    rows.push({ rowIndex: i + 2, sku, values });
  }

  for (const e of result.errors ?? []) {
    errors.push({ rowIndex: (e.row ?? 0) + 2, message: e.message });
  }

  return { rows, errors };
}

export type InventoryDiffField = {
  field: InventoryField;
  label: string;
  before: string;
  after: string;
  warning?: string;
};

export type InventoryDiff = {
  productId: string;
  sku: string;
  productName: string;
  changes: InventoryDiffField[];
  selectable: boolean;
};

export type DiffResult = {
  diffs: InventoryDiff[];
  missing: { sku: string; rowIndex: number; name: string }[];
  parseErrors: { rowIndex: number; message: string }[];
};

export function diffInventory(
  currentProducts: ProductExportRow[],
  parsed: ParsedCsv,
  knownSupplierNames: Set<string>,
): DiffResult {
  const bySku = new Map<string, ProductExportRow>();
  for (const p of currentProducts) bySku.set(p.sku, p);

  const diffs: InventoryDiff[] = [];
  const missing: { sku: string; rowIndex: number; name: string }[] = [];

  for (const row of parsed.rows) {
    const cur = bySku.get(row.sku);
    if (!cur) {
      missing.push({
        sku: row.sku,
        rowIndex: row.rowIndex,
        name: row.values.name ?? "",
      });
      continue;
    }

    const changes: InventoryDiffField[] = [];
    let selectable = true;

    if ("name" in row.values) {
      const newName = row.values.name ?? "";
      if (newName !== cur.name) {
        changes.push({ field: "name", label: "Nombre", before: cur.name, after: newName });
      }
    }

    if ("priceCents" in row.values) {
      const newCents = csvDecimalToCents(row.values.priceCents);
      if (newCents == null) {
        changes.push({
          field: "priceCents",
          label: "Precio de venta (CUP)",
          before: centsToCsvDecimal(cur.priceCents),
          after: row.values.priceCents ?? "",
          warning: "Valor no numérico, se omitirá al aplicar.",
        });
        selectable = false;
      } else if (newCents !== cur.priceCents) {
        changes.push({
          field: "priceCents",
          label: "Precio de venta (CUP)",
          before: centsToCsvDecimal(cur.priceCents),
          after: centsToCsvDecimal(newCents),
        });
      }
    }

    if ("transferPriceCents" in row.values) {
      const newCents = csvDecimalToCents(row.values.transferPriceCents);
      if (newCents == null && (row.values.transferPriceCents ?? "") !== "") {
        changes.push({
          field: "transferPriceCents",
          label: "PVP transferencia (CUP)",
          before: centsToCsvDecimal(cur.transferPriceCents),
          after: row.values.transferPriceCents ?? "",
          warning: "Valor no numérico, se omitirá al aplicar.",
        });
        selectable = false;
      } else if (newCents != null && newCents !== cur.transferPriceCents) {
        changes.push({
          field: "transferPriceCents",
          label: "PVP transferencia (CUP)",
          before: centsToCsvDecimal(cur.transferPriceCents),
          after: centsToCsvDecimal(newCents),
        });
      }
    }

    if ("priceUsdCents" in row.values) {
      const raw = row.values.priceUsdCents ?? "";
      const newCents = raw === "" ? 0 : csvDecimalToCents(raw);
      if (newCents == null) {
        changes.push({
          field: "priceUsdCents",
          label: "PVP (USD)",
          before: centsToCsvDecimal(cur.priceUsdCents),
          after: raw,
          warning: "Valor no numérico, se omitirá al aplicar.",
        });
        selectable = false;
      } else if (newCents !== cur.priceUsdCents) {
        changes.push({
          field: "priceUsdCents",
          label: "PVP (USD)",
          before: centsToCsvDecimal(cur.priceUsdCents),
          after: centsToCsvDecimal(newCents),
        });
      }
    }

    if ("costCents" in row.values) {
      const raw = row.values.costCents ?? "";
      const newCents = raw === "" ? null : csvDecimalToCents(raw);
      if (newCents === undefined) {
        changes.push({
          field: "costCents",
          label: "Compra al proveedor (CUP)",
          before: centsToCsvDecimal(cur.costCents),
          after: raw,
          warning: "Valor no numérico, se omitirá al aplicar.",
        });
        selectable = false;
      } else if (newCents !== cur.costCents) {
        changes.push({
          field: "costCents",
          label: "Compra al proveedor (CUP)",
          before: centsToCsvDecimal(cur.costCents),
          after: centsToCsvDecimal(newCents),
        });
      }
    }

    if ("unitsPerBox" in row.values) {
      const n = parseInt(row.values.unitsPerBox ?? "", 10);
      if (!Number.isFinite(n) || n < 1) {
        changes.push({
          field: "unitsPerBox",
          label: "Ud/caja",
          before: String(cur.unitsPerBox),
          after: row.values.unitsPerBox ?? "",
          warning: "Debe ser un entero ≥ 1, se omitirá al aplicar.",
        });
        selectable = false;
      } else if (n !== cur.unitsPerBox) {
        changes.push({
          field: "unitsPerBox",
          label: "Ud/caja",
          before: String(cur.unitsPerBox),
          after: String(n),
        });
      }
    }

    if ("wholesaleCupCents" in row.values) {
      const raw = row.values.wholesaleCupCents ?? "";
      const newCents = raw === "" ? null : csvDecimalToCents(raw);
      if (newCents === undefined) {
        changes.push({
          field: "wholesaleCupCents",
          label: "Mayorista (CUP)",
          before: centsToCsvDecimal(cur.wholesaleCupCents),
          after: raw,
          warning: "Valor no numérico, se omitirá al aplicar.",
        });
        selectable = false;
      } else if (newCents !== cur.wholesaleCupCents) {
        changes.push({
          field: "wholesaleCupCents",
          label: "Mayorista (CUP)",
          before: centsToCsvDecimal(cur.wholesaleCupCents),
          after: centsToCsvDecimal(newCents),
        });
      }
    }

    if ("stockQty" in row.values) {
      const n = parseInt(row.values.stockQty ?? "", 10);
      if (!Number.isFinite(n) || n < 0) {
        changes.push({
          field: "stockQty",
          label: "Stock",
          before: String(cur.stockQty),
          after: row.values.stockQty ?? "",
          warning: "Debe ser un entero ≥ 0, se omitirá al aplicar.",
        });
        selectable = false;
      } else if (n !== cur.stockQty) {
        changes.push({
          field: "stockQty",
          label: "Stock",
          before: String(cur.stockQty),
          after: String(n),
        });
      }
    }

    if ("lowStockAt" in row.values) {
      const n = parseInt(row.values.lowStockAt ?? "", 10);
      if (!Number.isFinite(n) || n < 0) {
        changes.push({
          field: "lowStockAt",
          label: "Alerta stock",
          before: String(cur.lowStockAt),
          after: row.values.lowStockAt ?? "",
          warning: "Debe ser un entero ≥ 0, se omitirá al aplicar.",
        });
        selectable = false;
      } else if (n !== cur.lowStockAt) {
        changes.push({
          field: "lowStockAt",
          label: "Alerta stock",
          before: String(cur.lowStockAt),
          after: String(n),
        });
      }
    }

    if ("supplierName" in row.values) {
      const newName = (row.values.supplierName ?? "").trim();
      const curName = cur.supplierName ?? "";
      if (newName !== curName) {
        let warning: string | undefined;
        if (newName.length > 0) {
          const lower = newName.toLowerCase();
          const match = Array.from(knownSupplierNames).some((n) => n.toLowerCase() === lower);
          if (!match) {
            warning = `El proveedor "${newName}" no existe en el nomenclador. Se actualizará solo el nombre (no el id).`;
          }
        }
        changes.push({
          field: "supplierName",
          label: "Proveedor",
          before: curName || "(sin proveedor)",
          after: newName || "(sin proveedor)",
          warning,
        });
      }
    }

    if ("active" in row.values) {
      const raw = (row.values.active ?? "").trim().toLowerCase();
      let newActive: boolean | null = null;
      if (raw === "1" || raw === "true" || raw === "si" || raw === "sí" || raw === "yes") {
        newActive = true;
      } else if (raw === "0" || raw === "false" || raw === "no") {
        newActive = false;
      }
      if (newActive == null && raw !== "") {
        changes.push({
          field: "active",
          label: "Activo",
          before: cur.active ? "1" : "0",
          after: raw,
          warning: "Valor no reconocido (usa 1/0 o sí/no), se omitirá al aplicar.",
        });
        selectable = false;
      } else if (newActive != null && newActive !== cur.active) {
        changes.push({
          field: "active",
          label: "Activo",
          before: cur.active ? "1" : "0",
          after: newActive ? "1" : "0",
        });
      }
    }

    if (changes.length > 0) {
      diffs.push({
        productId: cur.id,
        sku: cur.sku,
        productName: cur.name,
        changes,
        selectable,
      });
    }
  }

  return { diffs, missing, parseErrors: parsed.errors };
}

export type AppliedChange = {
  field: InventoryField;
  value: string | number | boolean | null;
};

export type AppliedProductUpdate = {
  productId: string;
  changes: AppliedChange[];
};

export function buildBulkPayload(
  diffs: InventoryDiff[],
  selectedIndexes: Set<number>,
): AppliedProductUpdate[] {
  const out: AppliedProductUpdate[] = [];
  for (let i = 0; i < diffs.length; i++) {
    if (!selectedIndexes.has(i)) continue;
    const d = diffs[i]!;
    const changes: AppliedChange[] = [];
    for (const c of d.changes) {
      if (c.warning) continue;
      switch (c.field) {
        case "name":
          changes.push({ field: "name", value: c.after });
          break;
        case "priceCents":
          changes.push({ field: "priceCents", value: csvDecimalToCents(c.after) });
          break;
        case "transferPriceCents": {
          const v = csvDecimalToCents(c.after);
          if (v != null) changes.push({ field: "transferPriceCents", value: v });
          break;
        }
        case "priceUsdCents": {
          const v = c.after === "" ? 0 : csvDecimalToCents(c.after);
          if (v != null) changes.push({ field: "priceUsdCents", value: v });
          break;
        }
        case "costCents": {
          const v = c.after === "" ? null : csvDecimalToCents(c.after);
          if (v !== undefined) changes.push({ field: "costCents", value: v });
          break;
        }
        case "unitsPerBox": {
          const n = parseInt(c.after, 10);
          if (Number.isFinite(n) && n >= 1) changes.push({ field: "unitsPerBox", value: n });
          break;
        }
        case "wholesaleCupCents": {
          const v = c.after === "" ? null : csvDecimalToCents(c.after);
          if (v !== undefined) changes.push({ field: "wholesaleCupCents", value: v });
          break;
        }
        case "stockQty": {
          const n = parseInt(c.after, 10);
          if (Number.isFinite(n) && n >= 0) changes.push({ field: "stockQty", value: n });
          break;
        }
        case "lowStockAt": {
          const n = parseInt(c.after, 10);
          if (Number.isFinite(n) && n >= 0) changes.push({ field: "lowStockAt", value: n });
          break;
        }
        case "supplierName": {
          const trimmed = c.after === "(sin proveedor)" ? "" : c.after;
          changes.push({ field: "supplierName", value: trimmed });
          break;
        }
        case "active": {
          changes.push({ field: "active", value: c.after === "1" });
          break;
        }
      }
    }
    if (changes.length > 0) {
      out.push({ productId: d.productId, changes });
    }
  }
  return out;
}
