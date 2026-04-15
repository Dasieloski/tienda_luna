"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { STATIC_ADMIN_EMAIL, STATIC_ADMIN_PASSWORD } from "@/lib/static-admin-auth";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(STATIC_ADMIN_EMAIL);
  const [password, setPassword] = useState(STATIC_ADMIN_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    });
    setLoading(false);
    if (!res.ok) {
      setError("Correo o contraseña incorrectos.");
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md flex-col justify-center py-8">
      <div className="tl-reveal rounded-3xl border border-white/10 bg-zinc-900/70 p-8 shadow-2xl shadow-black/40 ring-1 ring-white/5 backdrop-blur-md">
        <p className="text-xs font-semibold uppercase tracking-wider text-violet-400">Acceso seguro</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">Administrador</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Acceso provisional fijo (sin comprobar usuarios en BD). Puedes cambiar correo y clave en{" "}
          <code className="rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs text-zinc-300">
            lib/static-admin-auth.ts
          </code>{" "}
          o en variables <code className="text-zinc-300">STATIC_ADMIN_*</code>.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="admin-email" className="block text-sm font-medium text-zinc-300">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              className="mt-1.5 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/80 px-3.5 py-2.5 text-white placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              autoComplete="username"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-zinc-300">
              Contraseña
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              className="mt-1.5 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/80 px-3.5 py-2.5 text-white focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              autoComplete="current-password"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "login-error" : undefined}
            />
          </div>
          {error ? (
            <p id="login-error" role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition-[transform,opacity,box-shadow] hover:bg-violet-500 hover:shadow-violet-900/40 disabled:cursor-not-allowed disabled:opacity-55 motion-safe:active:scale-[0.99]"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-500">
          <Link href="/" className="text-zinc-400 underline-offset-4 hover:text-white hover:underline">
            Volver al inicio
          </Link>
        </p>
      </div>
    </div>
  );
}
