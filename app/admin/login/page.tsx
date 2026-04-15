"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import Link from "next/link"
import { STATIC_ADMIN_EMAIL, STATIC_ADMIN_PASSWORD } from "@/lib/static-admin-auth"
import { ArrowLeft, Eye, EyeOff, Loader2, Lock, Mail, ShoppingBag } from "lucide-react"

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState(STATIC_ADMIN_EMAIL)
  const [password, setPassword] = useState(STATIC_ADMIN_PASSWORD)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      credentials: "include",
    })
    setLoading(false)
    if (!res.ok) {
      setError("Correo o contrasena incorrectos.")
      return
    }
    router.push("/admin")
    router.refresh()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      {/* Ambient glow effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-[30%] left-1/2 h-[60%] w-[60%] -translate-x-1/2 rounded-full bg-accent/8 blur-[100px]" />
        <div className="absolute -bottom-[20%] -right-[10%] h-[40%] w-[30%] rounded-full bg-violet-500/5 blur-[80px]" />
      </div>

      {/* Noise texture */}
      <div 
        className="pointer-events-none fixed inset-0 opacity-[0.015]" 
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")" }}
        aria-hidden 
      />

      {/* Back link */}
      <Link
        href="/"
        className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-2 text-xs font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted hover:text-foreground sm:left-6 sm:top-6"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver al inicio
      </Link>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-violet-600 text-white shadow-lg shadow-accent/25 ring-2 ring-border">
            <ShoppingBag className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-foreground">Tienda Luna</h1>
          <p className="mt-1 text-sm text-muted-foreground">Panel de administracion</p>
        </div>

        {/* Card */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-2xl shadow-black/20 ring-1 ring-border/50 backdrop-blur-xl">
          {/* Card header */}
          <div className="border-b border-border bg-muted/30 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
                <Lock className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Acceso seguro</p>
                <p className="text-xs text-muted-foreground">Ingresa tus credenciales</p>
              </div>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} className="p-6">
            <div className="space-y-4">
              {/* Email */}
              <div>
                <label htmlFor="admin-email" className="mb-1.5 block text-sm font-medium text-foreground">
                  Correo electronico
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <input
                    id="admin-email"
                    type="email"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors"
                    placeholder="admin@tienda.com"
                    autoComplete="username"
                    required
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "login-error" : undefined}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="admin-password" className="mb-1.5 block text-sm font-medium text-foreground">
                  Contrasena
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <input
                    id="admin-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                    className="w-full rounded-lg border border-border bg-background py-2.5 pl-10 pr-10 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors"
                    autoComplete="current-password"
                    required
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? "login-error" : undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Ocultar contrasena" : "Mostrar contrasena"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
                <p id="login-error" role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground shadow-lg shadow-accent/20 transition-all hover:bg-accent/90 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ingresando...
                </>
              ) : (
                "Ingresar al panel"
              )}
            </button>
          </form>

          {/* Footer info */}
          <div className="border-t border-border bg-muted/20 px-6 py-4">
            <p className="text-center text-xs text-muted-foreground">
              Credenciales de prueba preconfiguradas. Puedes cambiarlas en{" "}
              <code className="rounded bg-background px-1.5 py-0.5 text-[11px] font-mono text-foreground">
                lib/static-admin-auth.ts
              </code>
            </p>
          </div>
        </div>

        {/* Help text */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Problemas para acceder?{" "}
          <a href="#" className="font-medium text-accent hover:text-accent/80 transition-colors">
            Contactar soporte
          </a>
        </p>
      </div>
    </div>
  )
}
