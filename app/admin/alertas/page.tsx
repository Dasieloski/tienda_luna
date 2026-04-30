"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangleIcon as AlertTriangle,
  ShieldIcon as Shield,
  ShieldAlertIcon as ShieldAlert,
  ShieldCheckIcon as ShieldCheck,
} from "@/components/ui/icons";
import { AdminShell } from "@/components/admin/admin-shell";
import { KpiCard } from "@/components/admin/kpi-card";
import { DataTable, type Column } from "@/components/admin/data-table";
import { cn } from "@/lib/utils";

type AuditEvent = {
  id: string;
  type: string;
  status: string;
  deviceId: string;
  isFraud: boolean;
  fraudReason: string | null;
  serverTimestamp: string;
};

type Anomaly = {
  id: string;
  type: string;
  deviceId: string;
  status: string;
  isFraud: boolean;
  fraudReason: string | null;
  serverTimestamp: string;
};

type Overview = {
  level1: {
    eventosFraudulentos: number;
  };
  level3: {
    anomalias: Anomaly[];
  };
};

function AlertsPageClient() {
  const searchParams = useSearchParams();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [fraudCount, setFraudCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [onlyFraud, setOnlyFraud] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [eventsRes, overviewRes] = await Promise.all([
        fetch("/api/events?limit=50", { credentials: "include" }),
        fetch("/api/stats/overview", { credentials: "include" }),
      ]);

      if (eventsRes.ok) {
        const eventsJson = (await eventsRes.json()) as { events: AuditEvent[] };
        setEvents(eventsJson.events ?? []);
      }

      if (overviewRes.ok) {
        const overviewJson = (await overviewRes.json()) as Overview;
        setAnomalies(overviewJson.level3.anomalias ?? []);
        setFraudCount(overviewJson.level1.eventosFraudulentos ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Sin auto-refresh: solo carga inicial.

  // Drill-down: /admin/alertas?fraud=1
  useEffect(() => {
    const fraud = searchParams.get("fraud");
    if (fraud === "1" || fraud?.toLowerCase() === "true") {
      setOnlyFraud(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fraudEvents = events.filter((e) => e.isFraud);
  const normalEvents = events.filter((e) => !e.isFraud);
  const tableEvents = onlyFraud ? fraudEvents : events;

  const eventColumns: Column<AuditEvent>[] = [
    {
      key: "type",
      label: "Tipo",
      sortable: true,
      render: (row) => (
        <span className="font-medium text-tl-ink">{row.type}</span>
      ),
    },
    {
      key: "status",
      label: "Estado",
      width: "120px",
      render: (row) => (
        <span className="text-tl-muted">{row.status}</span>
      ),
    },
    {
      key: "isFraud",
      label: "Fraude",
      width: "100px",
      render: (row) => (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            row.isFraud
              ? "bg-tl-danger-subtle text-tl-danger"
              : "bg-tl-success-subtle text-tl-success"
          )}
        >
          {row.isFraud ? (
            <>
              <ShieldAlert className="h-3 w-3" aria-hidden />
              Sí
            </>
          ) : (
            <>
              <ShieldCheck className="h-3 w-3" aria-hidden />
              No
            </>
          )}
        </span>
      ),
    },
    {
      key: "deviceId",
      label: "Dispositivo",
      width: "140px",
      render: (row) => (
        <span className="truncate font-mono text-xs text-tl-muted" title={row.deviceId}>
          {row.deviceId.length > 12 ? `${row.deviceId.slice(0, 10)}...` : row.deviceId}
        </span>
      ),
    },
    {
      key: "serverTimestamp",
      label: "Fecha",
      sortable: true,
      width: "180px",
      render: (row) => (
        <span className="text-xs tabular-nums text-tl-muted">
          {new Date(row.serverTimestamp).toLocaleString("es-ES")}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <AdminShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Shield className="h-8 w-8 text-tl-accent tl-pulse" aria-hidden />
            <p className="text-sm text-tl-muted">Cargando alertas...</p>
          </div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Alertas">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="tl-welcome-header">Alertas y fraude</h1>
          <p className="mt-1 text-sm text-tl-muted">
            Monitoreo de anomalías y eventos sospechosos
          </p>
        </div>

        {/* KPIs */}
        <section>
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              label="Eventos fraude"
              value={String(fraudCount)}
              variant={fraudCount > 0 ? "danger" : "success"}
              icon={fraudCount > 0 ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            />
            <KpiCard
              label="Anomalías detectadas"
              value={String(anomalies.length)}
              variant={anomalies.length > 0 ? "warning" : "default"}
            />
            <KpiCard
              label="Eventos totales"
              value={String(events.length)}
            />
          </div>
        </section>

        {/* Fraud alerts - prominent */}
        {fraudEvents.length > 0 && (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-tl-danger" aria-hidden />
              <h2 className="text-lg font-semibold text-tl-danger">Alertas de fraude</h2>
            </div>
            <div className="space-y-3">
              {fraudEvents.map((e) => (
                <div
                  key={e.id}
                  className="tl-glass rounded-xl border-tl-danger/30 bg-tl-danger-subtle/50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-tl-danger">{e.type}</p>
                      <p className="mt-1 text-sm text-tl-muted">
                        Dispositivo: <span className="font-mono">{e.deviceId}</span>
                      </p>
                      {e.fraudReason && (
                        <p className="mt-2 text-sm text-tl-warning">{e.fraudReason}</p>
                      )}
                    </div>
                    <time className="text-xs tabular-nums text-tl-muted">
                      {new Date(e.serverTimestamp).toLocaleString("es-ES")}
                    </time>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Anomalies */}
        {anomalies.length > 0 && (
          <section>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-tl-ink">Anomalías</h2>
              <p className="mt-0.5 text-sm text-tl-muted">Eventos que requieren revisión</p>
            </div>
            <div className="space-y-2">
              {anomalies.map((a) => (
                <div
                  key={a.id}
                  className={cn(
                    "tl-glass rounded-xl p-4",
                    a.isFraud && "border-tl-danger/20 bg-tl-danger-subtle/30"
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-tl-ink">{a.type}</p>
                        {a.isFraud && (
                          <span className="rounded-full bg-tl-danger-subtle px-2 py-0.5 text-[10px] font-semibold uppercase text-tl-danger">
                            Fraude
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-tl-muted">
                        {a.status} - <span className="font-mono">{a.deviceId}</span>
                      </p>
                      {a.fraudReason && (
                        <p className="mt-1 text-sm text-tl-warning">{a.fraudReason}</p>
                      )}
                    </div>
                    <time className="text-xs tabular-nums text-tl-muted">
                      {new Date(a.serverTimestamp).toLocaleString("es-ES")}
                    </time>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* All events table */}
        <section>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-tl-ink">Auditoría de eventos</h2>
              <p className="mt-0.5 text-sm text-tl-muted">
                {onlyFraud ? "Mostrando solo eventos marcados como fraude" : "Registro completo del sistema"}
              </p>
            </div>
            <button
              type="button"
              className="tl-btn tl-btn-secondary tl-interactive !px-4 !py-2"
              onClick={() => setOnlyFraud((v) => !v)}
              title={onlyFraud ? "Ver todos los eventos" : "Ver solo fraude"}
            >
              {onlyFraud ? "Ver todos" : "Solo fraude"}
            </button>
          </div>
          <DataTable
            columns={eventColumns}
            data={tableEvents}
            keyExtractor={(row) => row.id}
            searchable
            searchPlaceholder="Buscar por tipo o dispositivo..."
            searchKeys={["type", "deviceId"]}
            emptyMessage="No hay eventos registrados"
            maxHeight="400px"
            loading={loading}
            skeletonRows={10}
          />
        </section>
      </div>
    </AdminShell>
  );
}

export default function AlertsPage() {
  return (
    <Suspense
      fallback={
        <AdminShell title="Alertas">
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Shield className="h-8 w-8 text-tl-accent tl-pulse" aria-hidden />
              <p className="text-sm text-tl-muted">Cargando alertas...</p>
            </div>
          </div>
        </AdminShell>
      }
    >
      <AlertsPageClient />
    </Suspense>
  );
}
