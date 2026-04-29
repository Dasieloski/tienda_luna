"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor, RefreshCw, Save } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { cn } from "@/lib/utils";

type DeviceRow = {
  id: string;
  label: string;
  lastSeenAt: string | null;
  createdAt: string;
};

type ApiPayload = {
  meta: { dbAvailable: boolean; message?: string };
  devices: DeviceRow[];
};

export default function DispositivosPage() {
  const [data, setData] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/devices", { credentials: "include" });
      const json = (await res.json().catch(() => null)) as ApiPayload | null;
      if (!res.ok || !json) {
        setErr("No se pudieron cargar los dispositivos.");
        setData([]);
        return;
      }
      if (json.meta?.dbAvailable === false) {
        setErr(json.meta.message ?? "Base de datos no disponible.");
        setData([]);
        return;
      }
      setData(json.devices ?? []);
      setEditing((prev) => {
        const next = { ...prev };
        for (const d of json.devices ?? []) {
          if (next[d.id] == null) next[d.id] = d.label;
        }
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      setData([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveLabel(id: string) {
    const label = (editing[id] ?? "").trim();
    if (!label) return;
    setSavingId(id);
    setErr(null);
    try {
      const res = await fetch("/api/admin/devices", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ id, label }),
      });
      const j = (await res.json().catch(() => null)) as any;
      if (!res.ok) {
        setErr(j?.error ?? "No se pudo guardar.");
        return;
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminShell title="Dispositivos">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="tl-welcome-header">Dispositivos</h1>
            <p className="mt-2 text-sm text-tl-muted">
              El indicador “Tablet: hace X” se basa en <span className="font-semibold">`Device.lastSeenAt`</span>.
              Si la APK usa un `deviceId` fijo (ej. <span className="font-mono">device-luna-pos-001</span>), asegúrate de que
              el <span className="font-semibold">label</span> del dispositivo coincida.
            </p>
          </div>
          <button
            type="button"
            className="tl-btn tl-btn-secondary tl-interactive tl-hover-lift tl-press tl-focus !px-4 !py-2"
            onClick={() => void load()}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
            {refreshing ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        {err ? (
          <div className="rounded-2xl border border-tl-warning/25 bg-tl-warning-subtle px-4 py-3 text-sm text-tl-warning">
            {err}
          </div>
        ) : null}

        <div className="tl-glass overflow-hidden rounded-2xl border border-tl-line-subtle bg-tl-canvas shadow-sm">
          <div className="border-b border-tl-line px-4 py-3">
            <p className="text-sm font-semibold text-tl-ink">Listado</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-tl-line bg-tl-canvas-inset text-xs uppercase tracking-wide text-tl-muted">
                <tr>
                  <th className="px-4 py-3">Dispositivo</th>
                  <th className="px-4 py-3 w-[240px]">Label</th>
                  <th className="px-4 py-3 w-[200px]">Última señal</th>
                  <th className="px-4 py-3 w-[200px]">Creado</th>
                  <th className="px-4 py-3 w-[120px] text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tl-line-subtle">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-sm text-tl-muted">
                      Cargando…
                    </td>
                  </tr>
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-tl-muted">
                      No hay dispositivos.
                    </td>
                  </tr>
                ) : (
                  data.map((d) => (
                    <tr key={d.id} className="hover:bg-tl-canvas-subtle/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Monitor className="h-4 w-4 text-tl-muted" aria-hidden />
                          <span className="font-mono text-xs text-tl-muted" title={d.id}>
                            {d.id}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          className="tl-input h-9 w-full"
                          value={editing[d.id] ?? d.label}
                          onChange={(e) => setEditing((prev) => ({ ...prev, [d.id]: e.target.value }))}
                        />
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-tl-muted">
                        {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString("es-ES") : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-tl-muted">
                        {new Date(d.createdAt).toLocaleString("es-ES")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className={cn("tl-btn tl-btn-primary !px-3 !py-2 text-xs", savingId === d.id && "opacity-70")}
                            onClick={() => void saveLabel(d.id)}
                            disabled={savingId === d.id}
                            title="Guardar label"
                          >
                            <Save className="h-4 w-4" aria-hidden />
                            Guardar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminShell>
  );
}

