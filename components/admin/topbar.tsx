"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Clock,
  KeyRound,
  LayoutDashboard,
  Landmark,
  Menu,
  Plus,
  Package,
  RefreshCw,
  Settings,
  ShoppingCart,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TopbarProps {
  title?: string;
  onMenuClick?: () => void;
  usdRateCup?: number | null;
  onUsdRateCupChange?: (next: number) => void;
}

export function Topbar({
  title = "Dashboard",
  onMenuClick,
  usdRateCup,
  onUsdRateCupChange,
}: TopbarProps) {
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
  const [session, setSession] = useState<{ typ: "user" | "device"; role?: string; userId?: string } | null>(null);

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

  const label = useMemo(() => {
    const r = usdRateCup ?? 250;
    return `Cambio: ${r}`;
  }, [usdRateCup]);

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
          setSession({ typ: "user", role: json.role ?? undefined, userId: json.userId ?? undefined });
        } else if (json?.typ === "device") {
          setSession({ typ: "device" });
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

  async function loadNotifications() {
    setNotifLoading(true);
    try {
      const res = await fetch("/api/admin/notifications", { credentials: "include" });
      const json = (await res.json()) as any;
      if (res.ok) setNotifications(json.notifications ?? []);
    } finally {
      setNotifLoading(false);
    }
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
        headers: { "content-type": "application/json" },
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

      {/* Right: Settings, status, actions */}
      <div className="flex shrink-0 items-center gap-2">
        {/* Exchange rate (always accessible) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setValue(String(usdRateCup ?? 250));
              setError(null);
              setOpen((v) => !v);
            }}
            className="flex items-center gap-2 rounded-full border border-tl-line bg-tl-canvas-inset px-3 py-2 text-sm font-semibold text-tl-ink tl-interactive tl-hover-lift tl-press tl-focus hover:bg-tl-canvas-subtle"
            title="Cambiar tasa CUP/USD"
          >
            <RefreshCw className="h-4 w-4 text-tl-muted" aria-hidden />
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">Cambio</span>
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
              <div className="flex items-center justify-between gap-3 border-b border-tl-line px-4 py-3">
                <p className="text-sm font-semibold text-tl-ink">Notificaciones</p>
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-tl-muted hover:bg-tl-canvas-subtle"
                >
                  Cerrar
                </button>
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

