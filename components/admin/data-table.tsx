"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  width?: string;
  render?: (row: T, index: number) => React.ReactNode;
}

export type DataTablePagination = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Texto opcional entre botones */
  summary?: string;
};

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: (keyof T)[];
  emptyMessage?: string;
  className?: string;
  stickyHeader?: boolean;
  maxHeight?: string;
  onRowClick?: (row: T) => void;
  /** Resalta la fila seleccionada (p. ej. historial) */
  selectedKey?: string | null;
  /** Muestra filas skeleton en lugar del cuerpo */
  loading?: boolean;
  skeletonRows?: number;
  /** Paginación integrada con microfeedback */
  pagination?: DataTablePagination;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyExtractor,
  searchable = false,
  searchPlaceholder = "Buscar...",
  searchKeys = [],
  emptyMessage = "No hay datos disponibles",
  className,
  stickyHeader = true,
  maxHeight,
  onRowClick,
  selectedKey = null,
  loading = false,
  skeletonRows = 10,
  pagination,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filteredData =
    searchable && search.trim()
      ? data.filter((row) => {
          const searchLower = search.toLowerCase();
          return searchKeys.some((key) => {
            const value = row[key];
            if (value == null) return false;
            return String(value).toLowerCase().includes(searchLower);
          });
        })
      : data;

  const sortedData = sortKey
    ? [...filteredData].sort((a, b) => {
        const aVal = a[sortKey as keyof T];
        const bVal = b[sortKey as keyof T];

        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return sortDir === "asc" ? 1 : -1;
        if (bVal == null) return sortDir === "asc" ? -1 : 1;

        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        }

        const aStr = String(aVal);
        const bStr = String(bVal);
        return sortDir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
      })
    : filteredData;

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const rows = skeletonRows > 0 ? skeletonRows : 8;

  const renderCellContent = (row: T, col: Column<T>, index: number) =>
    col.render ? col.render(row, index) : String(row[col.key as keyof T] ?? "—");

  return (
    <div className={cn("tl-glass overflow-hidden rounded-xl", className)}>
      {searchable && (
        <div className="border-b border-tl-line p-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tl-muted" aria-hidden />
            <input
              type="search"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="tl-input pl-10"
              disabled={loading}
            />
          </div>
        </div>
      )}

      <div
        className="tl-table-desktop-wrap hidden overflow-auto md:block"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="tl-table min-w-[720px] w-full">
          <thead className={stickyHeader ? "sticky top-0 z-10" : undefined}>
            <tr>
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={cn(
                    col.sortable && "cursor-pointer select-none hover:text-tl-ink",
                    col.align === "center" && "text-center",
                    col.align === "right" && "text-right"
                  )}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={col.sortable && !loading ? () => handleSort(String(col.key)) : undefined}
                >
                  <div
                    className={cn(
                      "flex items-center gap-1",
                      col.align === "center" && "justify-center",
                      col.align === "right" && "justify-end"
                    )}
                  >
                    <span>{col.label}</span>
                    {col.sortable && sortKey === String(col.key) && !loading ? (
                      sortDir === "asc" ? (
                        <ChevronUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <ChevronDown className="h-3 w-3" aria-hidden />
                      )
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: rows }).map((_, r) => (
                <tr key={`sk-${r}`}>
                  {columns.map((col) => (
                    <td key={String(col.key)} className="align-middle">
                      <div
                        className={cn(
                          "tl-skeleton h-3.5 rounded-md",
                          col.align === "right" && "ml-auto max-w-[70%]",
                          col.align === "center" && "mx-auto max-w-[60%]",
                          !col.align && "max-w-[85%]"
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : sortedData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-tl-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedData.map((row, index) => {
                const k = keyExtractor(row);
                return (
                  <tr
                    key={k}
                    data-selected={selectedKey != null && k === selectedKey ? "true" : undefined}
                    className={cn(onRowClick && "cursor-pointer")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <td
                        key={String(col.key)}
                        className={cn(
                          col.align === "center" && "text-center",
                          col.align === "right" && "text-right"
                        )}
                      >
                        {renderCellContent(row, col, index)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="tl-table-mobile-wrap divide-y divide-tl-line-subtle md:hidden">
        {loading ? (
          Array.from({ length: rows }).map((_, r) => (
            <div key={`mobile-sk-${r}`} className="space-y-3 px-4 py-4">
              {columns.slice(0, 4).map((col) => (
                <div key={String(col.key)} className="space-y-1">
                  <div className="h-3 w-20 tl-skeleton rounded-md" />
                  <div className="h-4 w-full tl-skeleton rounded-md" />
                </div>
              ))}
            </div>
          ))
        ) : sortedData.length === 0 ? (
          <div className="px-4 py-10 text-center text-tl-muted">{emptyMessage}</div>
        ) : (
          sortedData.map((row, index) => {
            const k = keyExtractor(row);
            return (
              <button
                key={k}
                type="button"
                className={cn(
                  "block w-full space-y-3 px-4 py-4 text-left transition-colors",
                  selectedKey != null && k === selectedKey && "bg-tl-accent-subtle",
                )}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                disabled={!onRowClick}
              >
                {columns.map((col) => (
                  <div key={String(col.key)} className="flex items-start justify-between gap-3">
                    <span className="max-w-[42%] text-[11px] font-semibold uppercase tracking-wide text-tl-muted">
                      {col.label}
                    </span>
                    <div className="min-w-0 flex-1 text-right text-sm text-tl-ink">
                      {renderCellContent(row, col, index)}
                    </div>
                  </div>
                ))}
              </button>
            );
          })
        )}
      </div>

      {pagination && !loading && (
        <div className="tl-table-pagination">
          <p className="text-xs text-tl-muted">
            {pagination.summary ?? `Página ${pagination.page} de ${Math.max(1, pagination.totalPages)}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="tl-table-pagination__btn"
              onClick={() => pagination.onPageChange(Math.max(1, pagination.page - 1))}
              disabled={pagination.page <= 1}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Anterior
            </button>
            <button
              type="button"
              className="tl-table-pagination__btn"
              onClick={() =>
                pagination.onPageChange(
                  Math.min(Math.max(1, pagination.totalPages || 1), pagination.page + 1),
                )
              }
              disabled={pagination.page >= Math.max(1, pagination.totalPages || 1)}
              aria-label="Página siguiente"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
