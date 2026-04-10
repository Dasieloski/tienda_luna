"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
    <div className="mx-auto max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 shadow-xl">
      <h1 className="text-lg font-semibold text-white">Acceso administrador</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Acceso provisional fijo (sin comprobar usuarios en BD). Puedes cambiar correo y clave en{" "}
        <code className="text-zinc-300">lib/static-admin-auth.ts</code> o en variables{" "}
        <code className="text-zinc-300">STATIC_ADMIN_*</code>.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <label className="block text-sm text-zinc-300">
          Email
          <input
            type="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-violet-500"
            autoComplete="username"
            required
          />
        </label>
        <label className="block text-sm text-zinc-300">
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-violet-500"
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
