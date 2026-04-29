"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Clock,
  CloudOff,
  Cloudy,
  KeyRound,
  Link2,
  LayoutDashboard,
  Landmark,
  Menu,
  Plus,
  Package,
  RefreshCw,
  Rows3,
  Search,
  Settings,
  ShoppingCart,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface TopbarProps {
  title?: string;
  onMenuClick?: () => void;
  usdRateCup?: number | null;
  onUsdRateCupChange?: (next: number) => void;
}

type GlobalSearchHit =
  | { kind: "product"; id: string; title: string; subtitle: string }
  | { kind: "supplier"; id: string; title: string; subtitle: string };

type SyncStatusPayload = {
  meta: { dbAvailable: boolean };
  status: null | {
    now: string;
    lastDeviceEventAt: string | null;
    lastDeviceSeenAt: string | null;
    lastWebChangeAt: string | null;
    minutesSinceDevice: number | null;
    pendingForTablet: boolean;
    deviceStale: boolean;
  };
};

function fmtSince(minutes: number | null) {
  if (minutes == null) return "sin señal";
  const mins = Math.max(0, Math.round(minutes));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${m ? ` ${m} min` : ""}`;
}

export function Topbar({
  title = "Dashboard",
  onMenuClick,
  usdRateCup,
  onUsdRateCupChange,
}: TopbarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(() => (usdRateCup ?? 250).toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifications, setNotifications] = useState<
    { id: string; kind: string; title: string; body: string; ts: string }[]
  >([]);

  const [userOpen, setUserOpen] = useState(false);
  const [session, setSession] = useState<{
    typ: "user" | "device";
    storeId?: string;
    role?: string;
    userId?: string;
  } | null>(null);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNext, setPwdNext] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

  const [usersOpen, setUsersOpen] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [users, setUsers] = useState<{ id: string; email: string; role: string; createdAt: string }[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"ADMIN" | "CASHIER">("ADMIN");
  const [usersMsg, setUsersMsg] = useState<string | null>(null);

  // Buscador global
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchHits, setSearchHits] = useState<GlobalSearchHit[]>([]);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Indicador de sincronización tablet ↔ web
  const [sync, setSync] = useState<SyncStatusPayload["status"]>(null);
  const [syncErr, setSyncErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let t: number | null = null;
    async function load() {
      try {
        const res = await fetch("/api/admin/sync/status", { credentials: "include" });
        const json = (await res.json().catch(() => null)) as unknown;
        if (cancelled) return;
        const payload = (json && typeof json === "object" ? (json as SyncStatusPayload) : null) as SyncStatusPayload | null;
        setSync(payload?.status ?? null);
        setSyncErr(null);
      } catch (e) {
        if (cancelled) return;
        setSyncErr(e instanceof Error ? e.message : "sync");
      }
    }
    void load();
    t = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      if (t) window.clearInterval(t);
    };
  }, []);

  const syncChip = useMemo(() => {
    if (syncErr) {
      return { label: "Sync: —", title: "No se pudo verificar estado de sync", kind: "neutral" as const };
    }
    if (!sync) {
      return { label: "Sync: —", title: "Sin datos de sync todavía", kind: "neutral" as const };
    }
    const mins = sync.minutesSinceDevice;
    const stale = sync.deviceStale;
    const pending = sync.pendingForTablet;
    if (stale) {
      return {
        label: `Tablet: hace ${fmtSince(mins)}`,
        title: "El tablet parece sin conexión o sin sincronizar recientemente.",
        kind: "stale" as const,
      };
    }
    if (pending) {
      return {
        label: `Tablet: pendiente · hace ${fmtSince(mins)}`,
        title: `Hay cambios hechos desde la web que aún no se reflejan en el tablet. Último contacto: hace ${fmtSince(mins)}.`,
        kind: "pending" as const,
      };
    }
    return {
      label: `Tablet: al día`,
      title: mins != null ? `Último contacto hace ${fmtSince(mins)}.` : "Al día.",
      kind: "ok" as const,
    };
  }, [sync, syncErr]);

  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  useEffect(() => {
    try {
      const raw = localStorage.getItem("tl-density");
      const next = raw === "compact" ? "compact" : "comfortable";
      setDensity(next);
      document.documentElement.dataset.density = next;
    } catch {
      document.documentElement.dataset.density = "comfortable";
    }
  }, []);

  const label = useMemo(() => {
    const r = usdRateCup ?? 250;
    return `Cambio: ${r}`;
  }, [usdRateCup]);

  useEffect(() => {
    const q = searchQ.trim();
    if (!q) {
      setSearchHits([]);
      setSearchLoading(false);
      setSearchActiveIndex(0);
      return;
    }

    const t = window.setTimeout(async () => {
      searchAbortRef.current?.abort();
      const ac = new AbortController();
      searchAbortRef.current = ac;
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}&limit=10`, {
          credentials: "include",
          signal: ac.signal,
        });
        const json = (await res.json().catch(() => null)) as any;
        const prods = (json?.products ?? []) as any[];
        const sups = (json?.suppliers ?? []) as any[];

        const hits: GlobalSearchHit[] = [
          ...prods.slice(0, 7).map((p) => ({
            kind: "product" as const,
            id: String(p.id),
            title: String(p.name ?? "Producto"),
            subtitle: `SKU: ${String(p.sku ?? "—")} · ${p.supplierName ? String(p.supplierName) : "—"}`,
          })),
          ...sups.slice(0, 5).map((s) => ({
            kind: "supplier" as const,
            id: String(s.id),
            title: String(s.name ?? "Proveedor"),
            subtitle: s.phone ? String(s.phone) : "—",
          })),
        ].slice(0, 10);

        setSearchHits(hits);
        setSearchActiveIndex(0);
      } catch (e) {
        if ((e as any)?.name !== "AbortError") {
          setSearchHits([]);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 220);

    return () => window.clearTimeout(t);
  }, [searchQ]);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const root = searchWrapRef.current;
      if (!root) return;
      if (!searchOpen) return;
      if (!root.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [searchOpen]);

  function goToResults(q: string) {
    const t = q.trim();
    if (!t) return;
    setSearchOpen(false);
    router.push(`/admin/busqueda?q=${encodeURIComponent(t)}`);
  }

  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setError("El cambio debe ser un número mayor que 0.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/exchange-rate", {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usdRateCup: Math.round(n) }),
      });
      const json = (await res.json()) as { usdRateCup?: number; hint?: string; error?: string };
      if (!res.ok) {
        setError(json.hint ?? json.error ?? "No se pudo guardar el cambio.");
        return;
      }
      const next = Number(json.usdRateCup);
      if (Number.isFinite(next) && next > 0) {
        onUsdRateCupChange?.(next);
        setValue(String(next));
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const res = await fetch("/api/session/me", { credentials: "include" });
        if (!res.ok) return;
        const json = (await res.json()) as any;
        if (cancelled) return;
        if (json?.typ === "user") {
          setSession({
            typ: "user",
            storeId: typeof json.storeId === "string" ? json.storeId : undefined,
            role: json.role ?? undefined,
            userId: json.userId ?? undefined,
          });
        } else if (json?.typ === "device") {
          setSession({
            typ: "device",
            storeId: typeof json.storeId === "string" ? json.storeId : undefined,
          });
        }
      } catch {
        // ignore
      }
    }
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  function readDismissedNotificationIds(storeKey: string): Set<string> {
    try {
      const raw = localStorage.getItem(`tl-dismissed-notifications:${storeKey}`);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr.filter((x): x is string => typeof x === "string"));
    } catch {
      return new Set();
    }
  }

  function appendDismissedNotificationIds(storeKey: string, ids: string[]) {
    if (ids.length === 0) return;
    const prev = readDismissedNotificationIds(storeKey);
    for (const id of ids) prev.add(id);
    const next = [...prev];
    const capped = next.length > 800 ? next.slice(next.length - 800) : next;
    try {
      localStorage.setItem(`tl-dismissed-notifications:${storeKey}`, JSON.stringify(capped));
    } catch {
      // ignore quota / private mode
    }
  }

  async function resolveStoreKeyForNotifications(): Promise<string> {
    if (session?.storeId) return session.storeId;
    try {
      const res = await fetch("/api/session/me", { credentials: "include" });
      if (!res.ok) return "_";
      const json = (await res.json()) as { storeId?: string };
      return typeof json.storeId === "string" ? json.storeId : "_";
    } catch {
      return "_";
    }
  }

  async function loadNotifications() {
    setNotifLoading(true);
    try {
      const storeKey = await resolveStoreKeyForNotifications();
      const res = await fetch("/api/admin/notifications", { credentials: "include" });
      const json = (await res.json()) as any;
      if (!res.ok) return;
      const dismissed = readDismissedNotificationIds(storeKey);
      const list = (json.notifications ?? []) as { id: string; kind: string; title: string; body: string; ts: string }[];
      setNotifications(list.filter((n) => !dismissed.has(n.id)));
    } finally {
      setNotifLoading(false);
    }
  }

  async function clearAllNotifications() {
    if (notifications.length === 0) return;
    const storeKey = await resolveStoreKeyForNotifications();
    appendDismissedNotificationIds(
      storeKey,
      notifications.map((n) => n.id),
    );
    setNotifications([]);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => null);
    window.location.href = "/admin/login";
  }

  async function changePassword() {
    setPwdBusy(true);
    setPwdMsg(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: pwdCurrent, newPassword: pwdNext }),
      });
      const json = (await res.json()) as any;
      if (!res.ok) {
        setPwdMsg(json.hint ?? json.error ?? "No se pudo cambiar la contraseña.");
        return;
      }
      setPwdMsg("Contraseña actualizada.");
      setPwdCurrent("");
      setPwdNext("");
    } catch (e) {
      setPwdMsg(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setPwdBusy(false);
    }
  }

  async function loadUsers() {
    setUsersLoading(true);
    setUsersMsg(null);
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      const json = (await res.json()) as any;
      if (!res.ok) {
        setUsersMsg(json.error ?? "No se pudieron cargar usuarios.");
        return;
      }
      setUsers(json.users ?? []);
    } catch (e) {
      setUsersMsg(e instanceof Error ? e.message : "Error de red.");
    } finally {
      setUsersLoading(false);
    }
  }

  async function createUser() {
    setUsersMsg(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-tl-csrf": "1" },
        body: JSON.stringify({ email: newEmail, password: newPassword, role: newRole }),
      });
      const json = (await res.json()) as any;
      if (!res.ok) {
        setUsersMsg(json.error ?? "No se pudo crear usuario.");
        return;
      }
      setNewEmail("");
      setNewPassword("");
      await loadUsers();
    } catch (e) {
      setUsersMsg(e instanceof Error ? e.message : "Error de red.");
    }
  }

  async function deleteUser(id: string) {
    setUsersMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "x-tl-csrf": "1" },
      });
      const json = (await res.json()) as any;
      if (!res.ok) {
        setUsersMsg(json.error ?? "No se pudo eliminar usuario.");
        return;
      }
      await loadUsers();
    } catch (e) {
      setUsersMsg(e instanceof Error ? e.message : "Error de red.");
    }
  }

  return (
    <>
    <header className="sticky top-0 z-30 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-tl-line-subtle bg-tl-canvas/95 px-4 py-3 backdrop-blur sm:px-5 lg:min-h-20 lg:px-6">
      {/* Left: Logo and quick nav */}
      <div className="flex min-w-0 items-center gap-3 lg:gap-6">
        <button
          type="button"
          onClick={onMenuClick}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-tl-line bg-tl-canvas-inset text-tl-ink lg:hidden"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        {/* Topbar icons (sidebar is primary nav) */}
        <nav className="hidden items-center rounded-full border border-tl-line bg-tl-canvas-inset p-1 xl:flex">
          <TopIconLink href="/admin" active={title === "Dashboard"} label="Dashboard">
            <LayoutDashboard className="h-4 w-4" aria-hidden />
          </TopIconLink>
          <TopIconLink href="/admin/ventas" active={title === "Ventas"} label="Ventas">
            <ShoppingCart className="h-4 w-4" aria-hidden />
          </TopIconLink>
          <TopIconLink href="/admin/historial" active={title === "Historial"} label="Historial">
            <Clock className="h-4 w-4" aria-hidden />
          </TopIconLink>
          <TopIconLink href="/admin/inventario" active={title === "Inventario"} label="Inventario">
            <Package className="h-4 w-4" aria-hidden />
          </TopIconLink>
          <TopIconLink href="/admin/economia" active={title === "Economía"} label="Economía">
            <Landmark className="h-4 w-4" aria-hidden />
          </TopIconLink>
          <TopIconLink href="/admin/config" active={title === "Configuración"} label="Config">
            <Settings className="h-4 w-4" aria-hidden />
          </TopIconLink>
        </nav>
      </div>

      {/* Center: Global search */}
      <div className="hidden min-w-0 flex-1 justify-center lg:flex">
        <div ref={searchWrapRef} className="relative w-full max-w-xl">
          <label htmlFor="tl-global-search" className="sr-only">
            Buscar global
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tl-muted" aria-hidden />
            <input
              id="tl-global-search"
              type="search"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  goToResults(searchQ);
                  return;
                }
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSearchOpen(true);
                  setSearchActiveIndex((i) => Math.min((searchHits.length || 1) - 1, i + 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSearchOpen(true);
                  setSearchActiveIndex((i) => Math.max(0, i - 1));
                  return;
                }
              }}
              className="tl-input h-10 w-full pl-10"
              placeholder="Buscar: producto, proveedor, SKU, precio..."
              autoComplete="off"
            />
            {searchLoading ? (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-tl-muted">…</span>
            ) : null}
          </div>

          {searchOpen && searchQ.trim() && (
            <div
              className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-2xl border border-tl-line bg-tl-canvas shadow-lg"
              role="listbox"
              aria-label="Resultados de búsqueda"
            >
              {searchHits.length === 0 && !searchLoading ? (
                <div className="px-4 py-3 text-sm text-tl-muted">Sin coincidencias rápidas. Enter para ver todo.</div>
              ) : (
                <ul className="divide-y divide-tl-line-subtle">
                  {searchHits.map((h, idx) => (
                    <li key={`${h.kind}:${h.id}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={idx === searchActiveIndex}
                        className={cn(
                          "w-full px-4 py-3 text-left transition-colors hover:bg-tl-canvas-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-tl-accent/30",
                          idx === searchActiveIndex && "bg-tl-canvas-subtle",
                        )}
                        onMouseEnter={() => setSearchActiveIndex(idx)}
                        onClick={() => goToResults(searchQ)}
                      >
                        <p className="truncate text-sm font-semibold text-tl-ink">{h.title}</p>
                        <p className="truncate text-xs text-tl-muted">{h.subtitle}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="border-t border-tl-line-subtle px-4 py-2 text-[11px] text-tl-muted">
                Enter: ver todos los resultados · Esc: cerrar
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Settings, status, actions */}
      <div className="flex shrink-0 items-center gap-2">
        <div
          className={cn(
            "hidden items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-sm sm:inline-flex",
            "bg-gradient-to-b from-tl-canvas to-tl-canvas-inset",
            syncChip.kind === "ok" && "border-tl-success/25 text-tl-success",
            syncChip.kind === "pending" && "border-tl-warning/25 text-tl-warning",
            syncChip.kind === "stale" && "border-tl-danger/25 text-tl-danger",
            syncChip.kind === "neutral" && "border-tl-line text-tl-muted",
          )}
          title={syncChip.title}
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              syncChip.kind === "ok" && "bg-tl-success",
              syncChip.kind === "pending" && "bg-tl-warning",
              syncChip.kind === "stale" && "bg-tl-danger",
              syncChip.kind === "neutral" && "bg-tl-muted/60",
            )}
            aria-hidden
          />
          {syncChip.kind === "ok" ? (
            <Link2 className="h-4 w-4" aria-hidden />
          ) : syncChip.kind === "pending" ? (
            <Cloudy className="h-4 w-4" aria-hidden />
          ) : syncChip.kind === "stale" ? (
            <CloudOff className="h-4 w-4" aria-hidden />
          ) : (
            <Link2 className="h-4 w-4" aria-hidden />
          )}
          <span className="tabular-nums">{syncChip.label}</span>
        </div>
        <button
          type="button"
          className="hidden items-center gap-2 rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-2 text-xs font-semibold text-tl-ink tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle sm:inline-flex"
          onClick={() => {
            const next = density === "compact" ? "comfortable" : "compact";
            setDensity(next);
            try {
              localStorage.setItem("tl-density", next);
            } catch {
              // ignore
            }
            document.documentElement.dataset.density = next;
          }}
          title={density === "compact" ? "Cambiar a modo normal" : "Cambiar a modo denso"}
        >
          <Rows3 className="h-4 w-4 text-tl-muted" aria-hidden />
          {density === "compact" ? "Denso" : "Normal"}
        </button>
        {/* Exchange rate (always accessible) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setValue(String(usdRateCup ?? 250));
              setError(null);
              setOpen((v) => !v);
            }}
            className="flex min-w-0 max-w-[min(100%,11rem)] items-center gap-1.5 rounded-full border border-tl-line bg-tl-canvas-inset px-2.5 py-2 text-tl-ink tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle sm:max-w-none sm:gap-2 sm:px-3"
            title="Cambiar tasa CUP/USD"
          >
            <RefreshCw className="h-4 w-4 shrink-0 text-tl-muted" aria-hidden />
            <span className="truncate text-xs font-semibold tabular-nums sm:text-sm">{label}</span>
          </button>

          {open && (
            <div className="absolute right-0 top-12 z-50 w-[320px] max-w-[90vw] rounded-2xl border border-tl-line bg-tl-canvas p-4 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-tl-ink">Tipo de cambio</p>
                  <p className="mt-1 text-xs text-tl-muted">
                    Define cuántos CUP equivalen a 1 USD. Esto afecta el segundo valor mostrado en los cards.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-tl-muted hover:bg-tl-canvas-subtle"
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-3 grid gap-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
                  CUP por 1 USD
                </label>
                <input
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="tl-input h-10"
                  placeholder="Ej: 520"
                />
                <p className="text-xs text-tl-muted">
                  Ejemplo: {formatExample(1872000, Number(value) || (usdRateCup ?? 250))}
                </p>
                {error && (
                  <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-3 py-2 text-xs text-tl-warning">
                    {error}
                  </div>
                )}
                <div className="mt-1 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    className="tl-btn tl-btn-primary !px-3 !py-2 text-xs"
                    disabled={saving}
                  >
                    {saving ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="relative">
          <button
            type="button"
            className="relative flex h-10 w-10 items-center justify-center rounded-full border border-tl-line bg-tl-canvas-inset tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle"
            title="Notificaciones"
            onClick={() => {
              const next = !notifOpen;
              setNotifOpen(next);
              if (next) void loadNotifications();
            }}
          >
            <Bell className="h-4 w-4 text-tl-ink" aria-hidden />
            {notifications.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-tl-danger text-[10px] font-bold text-white">
                {Math.min(9, notifications.length)}
              </span>
            )}
            <span className="sr-only">Notificaciones</span>
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-12 z-50 w-[360px] max-w-[92vw] overflow-hidden rounded-2xl border border-tl-line bg-tl-canvas shadow-lg">
              <div className="flex items-center justify-between gap-2 border-b border-tl-line px-4 py-3">
                <p className="text-sm font-semibold text-tl-ink">Notificaciones</p>
                <div className="flex shrink-0 items-center gap-1">
                  {notifications.length > 0 && !notifLoading && (
                    <button
                      type="button"
                      onClick={() => void clearAllNotifications()}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-tl-danger hover:bg-tl-danger-subtle/40"
                      title="Ocultar todas hasta que haya alertas nuevas"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Eliminar todas
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNotifOpen(false)}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-tl-muted hover:bg-tl-canvas-subtle"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
              <div className="max-h-[60vh] overflow-auto">
                {notifLoading ? (
                  <div className="p-4 text-sm text-tl-muted">Cargando…</div>
                ) : notifications.length === 0 ? (
                  <div className="p-4 text-sm text-tl-muted">Sin notificaciones.</div>
                ) : (
                  <ul className="divide-y divide-tl-line-subtle">
                    {notifications.map((n) => (
                      <li key={n.id} className="px-4 py-3">
                        <p className="text-sm font-semibold text-tl-ink">{n.title}</p>
                        <p className="mt-0.5 text-xs text-tl-muted">{n.body}</p>
                        <p className="mt-1 text-[11px] text-tl-muted">
                          {new Date(n.ts).toLocaleString("es-ES")}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* User avatar */}
        <div className="relative">
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-tl-line bg-tl-canvas-inset tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle"
            title="Perfil"
            onClick={() => setUserOpen((v) => !v)}
          >
            <User className="h-5 w-5 text-tl-muted" aria-hidden />
          </button>

          {userOpen && (
            <div className="absolute right-0 top-12 z-50 w-[320px] max-w-[92vw] rounded-2xl border border-tl-line bg-tl-canvas p-3 shadow-lg">
              <div className="px-2 py-2">
                <p className="text-sm font-semibold text-tl-ink">Cuenta</p>
                <p className="mt-0.5 text-xs text-tl-muted">
                  {session?.typ === "user"
                    ? `Rol: ${session.role ?? "—"} · Usuario: ${session.userId ?? "—"}`
                    : "Sesión"}
                </p>
              </div>

              <div className="mt-2 grid gap-2 px-1">
                <button
                  type="button"
                  className="tl-btn tl-btn-secondary w-full justify-start !px-3 !py-2 text-xs"
                  onClick={() => {
                    setPwdMsg(null);
                    setPwdOpen(true);
                  }}
                >
                  <KeyRound className="h-4 w-4" aria-hidden />
                  Cambiar contraseña
                </button>

                <button
                  type="button"
                  className="tl-btn tl-btn-secondary w-full justify-start !px-3 !py-2 text-xs"
                  onClick={() => {
                    setUsersMsg(null);
                    setUsersOpen(true);
                    void loadUsers();
                  }}
                >
                  <Users className="h-4 w-4" aria-hidden />
                  Gestionar usuarios
                </button>

                <button
                  type="button"
                  className="tl-btn tl-btn-primary w-full justify-start !px-3 !py-2 text-xs"
                  onClick={() => void logout()}
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
    <Modal open={pwdOpen} title="Cambiar contraseña" onClose={() => setPwdOpen(false)}>
      <div className="grid gap-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
          Contraseña actual
        </label>
        <input
          type="password"
          className="tl-input h-10"
          value={pwdCurrent}
          onChange={(e) => setPwdCurrent(e.target.value)}
        />
        <label className="text-xs font-semibold uppercase tracking-wider text-tl-muted">
          Nueva contraseña
        </label>
        <input
          type="password"
          className="tl-input h-10"
          value={pwdNext}
          onChange={(e) => setPwdNext(e.target.value)}
        />
        {pwdMsg && (
          <div className="rounded-xl border border-tl-line-subtle bg-tl-canvas-inset px-3 py-2 text-xs text-tl-muted">
            {pwdMsg}
          </div>
        )}
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
            onClick={() => setPwdOpen(false)}
            disabled={pwdBusy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="tl-btn tl-btn-primary !px-3 !py-2 text-xs"
            onClick={() => void changePassword()}
            disabled={pwdBusy}
          >
            {pwdBusy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </Modal>

    <Modal open={usersOpen} title="Usuarios" onClose={() => setUsersOpen(false)}>
      <div className="space-y-4">
        <div className="tl-glass rounded-xl p-3">
          <p className="text-sm font-semibold text-tl-ink">Crear usuario</p>
          <div className="mt-3 grid gap-2">
            <input
              className="tl-input h-10"
              placeholder="correo@..."
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <input
              type="password"
              className="tl-input h-10"
              placeholder="contraseña"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <select
              className="tl-input h-10"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "ADMIN" | "CASHIER")}
            >
              <option value="ADMIN">ADMIN</option>
              <option value="CASHIER">CASHIER</option>
            </select>
            <button
              type="button"
              className="tl-btn tl-btn-primary !px-3 !py-2 text-xs"
              onClick={() => void createUser()}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Crear
            </button>
          </div>
        </div>

        {usersMsg && (
          <div className="rounded-xl border border-tl-warning/20 bg-tl-warning-subtle px-3 py-2 text-xs text-tl-warning">
            {usersMsg}
          </div>
        )}

        <div className="tl-glass overflow-hidden rounded-xl">
          <div className="border-b border-tl-line px-3 py-2">
            <p className="text-sm font-semibold text-tl-ink">Listado</p>
          </div>
          {usersLoading ? (
            <div className="p-3 text-sm text-tl-muted">Cargando…</div>
          ) : users.length === 0 ? (
            <div className="p-3 text-sm text-tl-muted">Sin usuarios.</div>
          ) : (
            <ul className="divide-y divide-tl-line-subtle">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-tl-ink">{u.email}</p>
                    <p className="text-xs text-tl-muted">{u.role}</p>
                  </div>
                  <button
                    type="button"
                    className="tl-btn tl-btn-secondary !px-3 !py-2 text-xs"
                    onClick={() => void deleteUser(u.id)}
                    title="Eliminar"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
    </>
  );
}

function formatExample(cupCents: number, rateCup: number) {
  const cup = cupCents / 100;
  const rate = Number.isFinite(rateCup) && rateCup > 0 ? rateCup : 1;
  const usd = cup / rate;
  const cupLabel = new Intl.NumberFormat("es-CU", {
    style: "currency",
    currency: "CUP",
    maximumFractionDigits: 2,
  }).format(cup);
  const usdLabel = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(usd);
  return `${cupLabel} · ${usdLabel}`;
}

function TopIconLink({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={cn(
        "tl-interactive flex h-9 w-9 items-center justify-center rounded-full transition-colors",
        active ? "bg-tl-accent text-tl-accent-fg" : "text-tl-muted hover:bg-tl-canvas-subtle",
      )}
    >
      {children}
    </Link>
  );
}

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-50 bg-black/35"
        onClick={onClose}
        aria-label="Cerrar modal"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-[520px] rounded-2xl border border-tl-line bg-tl-canvas shadow-xl">
          <div className="flex items-start justify-between gap-3 border-b border-tl-line px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-tl-ink">{title}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-tl-muted hover:bg-tl-canvas-subtle"
            >
              Cerrar
            </button>
          </div>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </>
  );
}

