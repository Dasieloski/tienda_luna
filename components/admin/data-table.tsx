"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

type FilterKind = "text" | "select" | "numberRange";

export type DataTableSorting = {
  key: string | null;
  dir: "asc" | "desc";
};

export type DataTableFilterValue =
  | { kind: "text"; value: string }
  | { kind: "select"; value: string }
  | { kind: "numberRange"; min: number | null; max: number | null };

export type DataTableFilters = Record<string, DataTableFilterValue | undefined>;

export type ColumnFilter<T> =
  | {
      kind: "text";
      placeholder?: string;
      /** Valor a filtrar (por defecto usa row[col.key]) */
      getValue?: (row: T) => unknown;
    }
  | {
      kind: "select";
      placeholder?: string;
      /** Opciones explícitas; si no se proveen se derivan de data */
      options?: { label: string; value: string }[];
      getValue?: (row: T) => unknown;
    }
  | {
      kind: "numberRange";
      placeholderMin?: string;
      placeholderMax?: string;
      getValue?: (row: T) => unknown;
    };

export interface Column<T> {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  align?: "left" | "center" | "right";
  width?: string;
  render?: (row: T, index: number) => React.ReactNode;
  /**
   * Filtro por columna (opcional). Si se define, `DataTable` renderiza controles
   * de filtro adaptados y aplica el filtrado en cliente (o notifica callbacks en modo controlado).
   */
  filter?: ColumnFilter<T>;
  /**
   * Valor para ordenar (opcional). Si no se define, se ordena por `row[key]`.
   * Útil para columnas con `render` (por ejemplo, fechas formateadas).
   */
  sortValue?: (row: T) => unknown;
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
  /** Si true, la tarjeta llena la altura disponible (útil en grids) */
  fillHeight?: boolean;
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
  /**
   * Modo controlado (opcional). Útil para tablas server-side: la página mantiene sorting/filters
   * y convierte a query params.
   */
  sorting?: DataTableSorting;
  onSortingChange?: (next: DataTableSorting) => void;
  filters?: DataTableFilters;
  onFiltersChange?: (next: DataTableFilters) => void;
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
  fillHeight = false,
  stickyHeader = true,
  maxHeight,
  onRowClick,
  selectedKey = null,
  loading = false,
  skeletonRows = 10,
  pagination,
  sorting,
  onSortingChange,
  filters,
  onFiltersChange,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKeyLocal, setSortKeyLocal] = useState<string | null>(null);
  const [sortDirLocal, setSortDirLocal] = useState<"asc" | "desc">("asc");
  const [filtersLocal, setFiltersLocal] = useState<DataTableFilters>({});
  const searchId = useId();

  const sortKey = sorting?.key ?? sortKeyLocal;
  const sortDir = sorting?.dir ?? sortDirLocal;
  const activeFilters = filters ?? filtersLocal;

  const setNextSorting = (next: DataTableSorting) => {
    if (onSortingChange) onSortingChange(next);
    else {
      setSortKeyLocal(next.key);
      setSortDirLocal(next.dir);
    }
  };

  const setNextFilters = (next: DataTableFilters) => {
    if (onFiltersChange) onFiltersChange(next);
    else setFiltersLocal(next);
  };

  const serverSideMode = Boolean(onFiltersChange || onSortingChange);

  const filterableColumns = useMemo(
    () => columns.filter((c) => c.filter != null),
    [columns],
  );

  const derivedSelectOptions = useMemo(() => {
    const out: Record<string, { label: string; value: string }[]> = {};
    for (const col of filterableColumns) {
      const f = col.filter;
      if (!f || f.kind !== "select" || (f.options && f.options.length > 0)) continue;
      const values = new Set<string>();
      for (const row of data) {
        const raw = f.getValue ? f.getValue(row as T) : (row as T)[col.key as keyof T];
        if (raw == null) continue;
        const s = String(raw).trim();
        if (!s) continue;
        values.add(s);
        if (values.size >= 60) break;
      }
      out[String(col.key)] = Array.from(values)
        .sort((a, b) => a.localeCompare(b))
        .map((v) => ({ label: v, value: v }));
    }
    return out;
  }, [data, filterableColumns]);

  const applyColumnFilters = (rows: T[]) => {
    if (filterableColumns.length === 0) return rows;
    const keys = Object.keys(activeFilters);
    if (keys.length === 0) return rows;

    return rows.filter((row) => {
      for (const col of filterableColumns) {
        const key = String(col.key);
        const f = col.filter;
        const v = activeFilters[key];
        if (!f || !v) continue;

        const raw = f.getValue ? f.getValue(row) : row[col.key as keyof T];

        if (v.kind === "text") {
          const t = v.value.trim().toLowerCase();
          if (!t) continue;
          if (raw == null) return false;
          if (!String(raw).toLowerCase().includes(t)) return false;
        }

        if (v.kind === "select") {
          const sel = v.value.trim();
          if (!sel) continue;
          if (raw == null) return false;
          if (String(raw) !== sel) return false;
        }

        if (v.kind === "numberRange") {
          if (raw == null) return false;
          const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
          if (!Number.isFinite(n)) return false;
          if (v.min != null && n < v.min) return false;
          if (v.max != null && n > v.max) return false;
        }
      }
      return true;
    });
  };

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

  const columnFilteredData = serverSideMode ? filteredData : applyColumnFilters(filteredData);

  const sortedData = sortKey
    ? serverSideMode
      ? columnFilteredData
      : [...columnFilteredData].sort((a, b) => {
        const col = columns.find((c) => String(c.key) === sortKey) ?? null;
        const aVal =
          col?.sortValue ? col.sortValue(a) : a[sortKey as keyof T];
        const bVal =
          col?.sortValue ? col.sortValue(b) : b[sortKey as keyof T];

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
    : columnFilteredData;

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setNextSorting({ key, dir: sortDir === "asc" ? "desc" : "asc" });
    } else {
      setNextSorting({ key, dir: "asc" });
    }
  };

  const rows = skeletonRows > 0 ? skeletonRows : 8;

  const renderCellContent = (row: T, col: Column<T>, index: number) =>
    col.render ? col.render(row, index) : String(row[col.key as keyof T] ?? "—");

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    for (const col of filterableColumns) {
      const k = String(col.key);
      const v = activeFilters[k];
      if (!v) continue;
      if (v.kind === "text" && v.value.trim()) {
        chips.push({ key: k, label: `${col.label}: ${v.value.trim()}` });
      }
      if (v.kind === "select" && v.value.trim()) {
        chips.push({ key: k, label: `${col.label}: ${v.value.trim()}` });
      }
      if (v.kind === "numberRange" && (v.min != null || v.max != null)) {
        const left = v.min != null ? String(v.min) : "…";
        const right = v.max != null ? String(v.max) : "…";
        chips.push({ key: k, label: `${col.label}: ${left}–${right}` });
      }
    }
    return chips;
  }, [activeFilters, filterableColumns]);

  return (
    <div
      className={cn(
        "tl-glass overflow-hidden rounded-xl",
        fillHeight && "flex h-full flex-col",
        className,
      )}
    >
      {(searchable || filterableColumns.length > 0) && (
        <div className="border-b border-tl-line p-4">
          <div className="flex flex-col gap-3">
            {searchable && (
              <div className="relative max-w-sm">
                <label htmlFor={searchId} className="sr-only">
                  {searchPlaceholder}
                </label>
                <Search
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tl-muted"
                  aria-hidden
                />
                <input
                  id={searchId}
                  type="search"
                  placeholder={searchPlaceholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="tl-input pl-10"
                  disabled={loading}
                />
              </div>
            )}

            {filterableColumns.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  {filterableColumns.map((col) => {
                    const f = col.filter!;
                    const k = String(col.key);
                    const cur = activeFilters[k];

                    if (f.kind === "text") {
                      const curText = cur?.kind === "text" ? cur.value : "";
                      return (
                        <div key={k} className="min-w-0 flex-1 sm:min-w-[200px]">
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-tl-muted">
                            {col.label}
                          </label>
                          <input
                            value={curText}
                            onChange={(e) =>
                              setNextFilters({
                                ...activeFilters,
                                [k]: { kind: "text", value: e.target.value },
                              })
                            }
                            className="tl-input"
                            placeholder={f.placeholder ?? `Filtrar ${col.label.toLowerCase()}…`}
                            disabled={loading}
                          />
                        </div>
                      );
                    }

                    if (f.kind === "select") {
                      const curSel = cur?.kind === "select" ? cur.value : "";
                      const options = f.options?.length ? f.options : derivedSelectOptions[k] ?? [];
                      return (
                        <div key={k} className="sm:min-w-[180px]">
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-tl-muted">
                            {col.label}
                          </label>
                          <select
                            value={curSel}
                            onChange={(e) =>
                              setNextFilters({
                                ...activeFilters,
                                [k]: { kind: "select", value: e.target.value },
                              })
                            }
                            className="tl-input"
                            disabled={loading}
                          >
                            <option value="">{f.placeholder ?? "Todos"}</option>
                            {options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    }

                    if (f.kind === "numberRange") {
                      const curRange = cur?.kind === "numberRange" ? cur : null;
                      const minVal = curRange?.min ?? "";
                      const maxVal = curRange?.max ?? "";
                      return (
                        <div key={k} className="sm:min-w-[220px]">
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-tl-muted">
                            {col.label}
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              inputMode="decimal"
                              value={String(minVal)}
                              onChange={(e) => {
                                const raw = e.target.value.trim();
                                const n = raw === "" ? null : Number(raw.replace(",", "."));
                                setNextFilters({
                                  ...activeFilters,
                                  [k]: {
                                    kind: "numberRange",
                                    min: raw === "" ? null : Number.isFinite(n) ? n : null,
                                    max: curRange?.max ?? null,
                                  },
                                });
                              }}
                              className="tl-input"
                              placeholder={f.placeholderMin ?? "Min"}
                              disabled={loading}
                            />
                            <input
                              inputMode="decimal"
                              value={String(maxVal)}
                              onChange={(e) => {
                                const raw = e.target.value.trim();
                                const n = raw === "" ? null : Number(raw.replace(",", "."));
                                setNextFilters({
                                  ...activeFilters,
                                  [k]: {
                                    kind: "numberRange",
                                    min: curRange?.min ?? null,
                                    max: raw === "" ? null : Number.isFinite(n) ? n : null,
                                  },
                                });
                              }}
                              className="tl-input"
                              placeholder={f.placeholderMax ?? "Max"}
                              disabled={loading}
                            />
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
                      onClick={() => setNextFilters({})}
                      disabled={loading || activeFilterChips.length === 0}
                      title="Limpiar filtros"
                    >
                      <X className="h-4 w-4" aria-hidden />
                      Limpiar
                    </button>
                  </div>
                </div>

                {activeFilterChips.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {activeFilterChips.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className="inline-flex items-center gap-2 rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-1 text-xs text-tl-ink-secondary transition-colors hover:bg-tl-canvas"
                        onClick={() => {
                          const next = { ...activeFilters };
                          delete next[c.key];
                          setNextFilters(next);
                        }}
                        title="Quitar filtro"
                        disabled={loading}
                      >
                        <span className="truncate">{c.label}</span>
                        <X className="h-3.5 w-3.5 text-tl-muted" aria-hidden />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div
        className={cn(
          "tl-table-desktop-wrap hidden overflow-auto md:block",
          fillHeight && "min-h-0 flex-1",
        )}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="tl-table min-w-[720px] w-full">
          <thead className={stickyHeader ? "sticky top-0 z-10" : undefined}>
            <tr>
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={cn(
                    col.align === "center" && "text-center",
                    col.align === "right" && "text-right"
                  )}
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={
                    col.sortable
                      ? sortKey === String(col.key)
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className={cn(
                        "inline-flex w-full select-none items-center gap-1 rounded-md px-1 py-0.5 text-left hover:text-tl-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-tl-accent/30",
                        col.align === "center" && "justify-center text-center",
                        col.align === "right" && "justify-end text-right",
                      )}
                      onClick={!loading ? () => handleSort(String(col.key)) : undefined}
                      disabled={loading}
                    >
                      <span>{col.label}</span>
                      {sortKey === String(col.key) && !loading ? (
                        sortDir === "asc" ? (
                          <ChevronUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <ChevronDown className="h-3 w-3" aria-hidden />
                        )
                      ) : (
                        <span className="sr-only">Sin ordenar</span>
                      )}
                      {sortKey === String(col.key) && !loading ? (
                        <span className="sr-only">
                          {sortDir === "asc" ? "Orden ascendente" : "Orden descendente"}
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    <div
                      className={cn(
                        "flex items-center gap-1",
                        col.align === "center" && "justify-center",
                        col.align === "right" && "justify-end"
                      )}
                    >
                      <span>{col.label}</span>
                    </div>
                  )}
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
            const clickable = Boolean(onRowClick) && !loading;
            return (
              <div
                key={k}
                className={cn(
                  "block w-full space-y-3 px-4 py-4 text-left transition-colors",
                  selectedKey != null && k === selectedKey && "bg-tl-accent-subtle",
                  clickable && "cursor-pointer hover:bg-tl-canvas-subtle focus:outline-none focus:ring-2 focus:ring-tl-accent/20",
                )}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => onRowClick?.(row) : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick?.(row);
                        }
                      }
                    : undefined
                }
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
              </div>
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
