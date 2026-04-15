"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
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

export default function AlertsPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [fraudCount, setFraudCount] = useState(0);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    function handleRefresh() {
      void loadData();
    }
    window.addEventListener("tl-refresh", handleRefresh);
    return () => window.removeEventListener("tl-refresh", handleRefresh);
  }, [loadData]);

  const fraudEvents = events.filter((e) => e.isFraud);
  const normalEvents = events.filter((e) => !e.isFraud);

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
    <AdminShell>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-tl-ink">Alertas y fraude</h1>
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
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-tl-ink">Auditoría de eventos</h2>
            <p className="mt-0.5 text-sm text-tl-muted">Registro completo del sistema</p>
          </div>
          <DataTable
            columns={eventColumns}
            data={events}
            keyExtractor={(row) => row.id}
            searchable
            searchPlaceholder="Buscar por tipo o dispositivo..."
            searchKeys={["type", "deviceId"]}
            emptyMessage="No hay eventos registrados"
            maxHeight="400px"
          />
        </section>
      </div>
    </AdminShell>
  );
}
