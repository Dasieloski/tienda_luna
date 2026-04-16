function escapeCell(value: string) {
  // CSV RFC4180-ish: si contiene comas, comillas o saltos, envolver en comillas y duplicar comillas.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsvRow(cells: Array<string | number | null | undefined>) {
  return cells
    .map((c) => escapeCell(c == null ? "" : String(c)))
    .join(",");
}

export function toCsv(
  header: Array<string | number>,
  rows: Array<Array<string | number | null | undefined>>,
) {
  const out = [toCsvRow(header)];
  for (const r of rows) out.push(toCsvRow(r));
  return out.join("\r\n") + "\r\n";
}

