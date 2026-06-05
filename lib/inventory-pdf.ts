import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ProductExportRow } from "@/lib/inventory-csv";

function centsToDecimal(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toFixed(2);
}

export function buildInventoryPdf(rows: ProductExportRow[]): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const now = new Date();
  const stamp = now.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Listado de inventario", 40, 48);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Generado: ${stamp}  ·  ${rows.length} productos activos`, 40, 64);
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 80,
    head: [["Nombre", "Precio de venta", "Precio de proveedor", "Proveedor", "Stock"]],
    body: rows.map((r) => [
      r.name,
      `${centsToDecimal(r.priceCents)} CUP`,
      r.costCents == null ? "—" : `${centsToDecimal(r.costCents)} CUP`,
      r.supplierName ?? "—",
      String(r.stockQty),
    ]),
    styles: {
      font: "helvetica",
      fontSize: 9,
      cellPadding: 5,
      lineColor: [220, 220, 220],
      lineWidth: 0.4,
      textColor: [30, 30, 30],
    },
    headStyles: {
      fillColor: [55, 65, 81],
      textColor: 255,
      fontStyle: "bold",
      halign: "left",
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 170 },
      1: { halign: "right", cellWidth: 80 },
      2: { halign: "right", cellWidth: 90 },
      3: { cellWidth: 110 },
      4: { halign: "right", cellWidth: 45 },
    },
    margin: { left: 40, right: 40 },
    didDrawPage: () => {
      const str = `Página ${doc.getNumberOfPages()}`;
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(str, doc.internal.pageSize.getWidth() - 60, doc.internal.pageSize.getHeight() - 24);
    },
  });

  return doc.output("blob");
}
