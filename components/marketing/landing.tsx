"use client"

import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CloudOff,
  HelpCircle,
  Layers3,
  LayoutDashboard,
  Lock,
  Package,
  Radar,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Workflow,
} from "lucide-react"
import Link from "next/link"

const pillars = [
  {
    icon: CloudOff,
    title: "Offline-first real",
    body: "Tu tienda sigue operando sin conexion. Los eventos quedan en cola hasta que vuelva la red.",
  },
  {
    icon: Workflow,
    title: "Sincronizacion inteligente",
    body: "Envios batch con reintentos seguros: menos ruido en red, mas control sobre la integracion.",
  },
  {
    icon: ShieldCheck,
    title: "Inventario centralizado",
    body: "Stock y reglas se aplican desde el servidor: una sola fuente de verdad para todos tus productos.",
  },
  {
    icon: Radar,
    title: "Alertas en tiempo real",
    body: "Notificaciones de stock bajo, ventas inusuales y anomalias para actuar rapido.",
  },
  {
    icon: BarChart3,
    title: "Analitica completa",
    body: "Ventas por hora, producto, categoria y tendencias para tomar mejores decisiones.",
  },
  {
    icon: Layers3,
    title: "Historial completo",
    body: "Trazabilidad de cada venta: que paso, cuando y desde que dispositivo.",
  },
] as const

const steps = [
  { n: "01", title: "Registra venta", desc: "Agrega productos al carrito y procesa el pago rapidamente." },
  { n: "02", title: "Sincroniza datos", desc: "Los eventos se envian al servidor cuando hay conexion." },
  { n: "03", title: "Actualiza stock", desc: "El inventario se ajusta automaticamente en tiempo real." },
  { n: "04", title: "Analiza resultados", desc: "Revisa metricas y reportes desde el panel administrativo." },
] as const

const faqs = [
  {
    q: "Que tipo de productos puedo vender?",
    a: "Tienda Luna esta disenada para tiendas de productos varios: abarrotes, articulos del hogar, papeleria, bebidas, snacks y mas.",
  },
  {
    q: "Funciona sin internet?",
    a: "Si. El sistema guarda las ventas localmente y las sincroniza automaticamente cuando vuelve la conexion.",
  },
  {
    q: "Como se maneja el inventario?",
    a: "El stock se actualiza en tiempo real con cada venta. Recibiras alertas cuando un producto este por agotarse.",
  },
] as const

const categories = [
  { name: "Abarrotes", icon: Package },
  { name: "Bebidas", icon: ShoppingBag },
  { name: "Limpieza", icon: Sparkles },
  { name: "Snacks", icon: Store },
]

export function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Ambient glow effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-[40%] left-1/2 h-[80%] w-[80%] -translate-x-1/2 rounded-full bg-accent/5 blur-[120px]" />
        <div className="absolute -bottom-[20%] -right-[10%] h-[50%] w-[40%] rounded-full bg-violet-500/5 blur-[100px]" />
      </div>

      {/* Noise texture */}
      <div 
        className="pointer-events-none fixed inset-0 opacity-[0.015]" 
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")" }}
        aria-hidden 
      />

      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-foreground"
      >
        Saltar al contenido
      </a>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="group flex items-center gap-3 rounded-2xl py-1 pr-2 transition-colors hover:bg-muted/50"
          >
            <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-accent to-violet-600 text-accent-foreground shadow-md ring-2 ring-border transition-transform duration-300 group-hover:scale-105">
              <ShoppingBag className="h-5 w-5" strokeWidth={2} aria-hidden />
              <span className="absolute inset-0 bg-gradient-to-t from-black/15 to-transparent" aria-hidden />
            </span>
            <span className="text-sm font-bold tracking-tight text-foreground">Tienda Luna</span>
          </Link>
          
          <nav
            aria-label="Principal"
            className="hidden items-center gap-1 rounded-full border border-border bg-card/50 p-1 shadow-inner md:flex"
          >
            {[
              { href: "#categorias", label: "Categorias", Icon: Package },
              { href: "#flujo", label: "Como funciona", Icon: Workflow },
              { href: "#pilares", label: "Beneficios", Icon: Layers3 },
              { href: "#faq", label: "FAQ", Icon: HelpCircle },
            ].map(({ href, label, Icon }) => (
              <a
                key={href}
                href={href}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
              >
                <Icon className="h-3.5 w-3.5 text-accent" aria-hidden />
                {label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/admin/login"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-accent to-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-accent/25 ring-1 ring-white/20 transition-all hover:shadow-xl hover:-translate-y-0.5 sm:text-sm"
            >
              Panel admin
              <LayoutDashboard className="h-4 w-4 opacity-95" aria-hidden />
            </Link>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="border-t border-border/40 bg-card/50 md:hidden">
          <nav
            aria-label="Secciones"
            className="mx-auto flex max-w-6xl flex-wrap justify-center gap-1 px-2 py-2.5"
          >
            {[
              { href: "#categorias", label: "Categorias", Icon: Package },
              { href: "#flujo", label: "Flujo", Icon: Workflow },
              { href: "#pilares", label: "Beneficios", Icon: Layers3 },
              { href: "#faq", label: "FAQ", Icon: HelpCircle },
            ].map(({ href, label, Icon }) => (
              <a
                key={href}
                href={href}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground shadow-sm hover:border-accent/30 hover:text-foreground"
              >
                <Icon className="h-3 w-3 text-accent" aria-hidden />
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main id="contenido-principal" className="relative">
        {/* Hero */}
        <section
          className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20"
          aria-labelledby="hero-title"
        >
          <div className="grid items-center gap-14 lg:grid-cols-[1fr_minmax(0,420px)] lg:gap-12">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur animate-in fade-in slide-in-from-bottom-2 duration-500">
                <Store className="h-3.5 w-3.5 text-accent" aria-hidden />
                Tu tienda de productos varios
              </p>
              <h1
                id="hero-title"
                className="mt-6 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl sm:leading-[1.06] lg:text-[3.25rem] animate-in fade-in slide-in-from-bottom-3 duration-500 delay-100"
              >
                Gestiona tu tienda con la precision que merece
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground sm:text-xl animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200">
                Sistema de punto de venta disenado para tiendas de productos varios. Controla inventario, registra ventas y analiza tu negocio desde cualquier lugar.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-300">
                <Link
                  href="/admin/login"
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background shadow-lg ring-1 ring-foreground/15 transition-all hover:shadow-xl hover:-translate-y-0.5"
                >
                  Iniciar sesion
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a
                  href="#categorias"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-6 py-3 text-sm font-medium text-foreground backdrop-blur transition-all hover:bg-muted hover:-translate-y-0.5"
                >
                  Ver categorias
                </a>
              </div>
            </div>

            {/* Hero visual */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-400">
              <div
                className="relative overflow-hidden rounded-3xl border border-border bg-card/70 p-1 shadow-2xl shadow-accent/10 ring-1 ring-border backdrop-blur-xl"
                role="img"
                aria-label="Vista previa del sistema de punto de venta"
              >
                <div className="rounded-[1.35rem] bg-gradient-to-br from-muted/50 via-transparent to-accent/10 p-6 sm:p-8">
                  <div className="grid gap-4">
                    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ventas del dia</p>
                      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">$12,450.00</p>
                      <p className="mt-1 text-xs text-success">+18% vs ayer</p>
                    </div>
                    <div className="rounded-2xl border border-accent/30 bg-accent/10 p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Productos vendidos</p>
                      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">847</p>
                      <p className="mt-1 text-xs text-muted-foreground">En 156 transacciones</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Stock bajo</p>
                      <p className="mt-2 text-sm font-medium text-foreground">12 productos por reabastecer</p>
                      <p className="mt-1 text-xs text-warning">Requiere atencion</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <dl className="mt-16 grid gap-6 border-t border-border/50 pt-12 sm:grid-cols-3 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-500">
            <div className="text-center sm:text-left">
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Disponibilidad</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">99.9%</dd>
              <dd className="mt-1 text-sm text-muted-foreground">Funciona offline</dd>
            </div>
            <div className="text-center sm:text-left">
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Transacciones</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">Ilimitadas</dd>
              <dd className="mt-1 text-sm text-muted-foreground">Sin restricciones</dd>
            </div>
            <div className="text-center sm:text-left">
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Soporte</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">24/7</dd>
              <dd className="mt-1 text-sm text-muted-foreground">Siempre disponible</dd>
            </div>
          </dl>
        </section>

        {/* Categories */}
        <section
          id="categorias"
          className="scroll-mt-24 border-t border-border/60 bg-muted/30 py-20"
          aria-labelledby="categorias-title"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 id="categorias-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Categorias de productos
              </h2>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Todo lo que tu tienda necesita vender
              </p>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
                Desde abarrotes hasta articulos de limpieza, gestiona todas las categorias de productos desde un solo lugar.
              </p>
            </div>
            
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {categories.map(({ name, icon: Icon }) => (
                <div
                  key={name}
                  className="group flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm ring-1 ring-border/40 transition-all hover:border-accent/30 hover:shadow-lg hover:-translate-y-1"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition-transform group-hover:scale-110">
                    <Icon className="h-7 w-7" aria-hidden />
                  </div>
                  <span className="text-sm font-semibold text-foreground">{name}</span>
                </div>
              ))}
            </div>

            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {[
                "Abarrotes: arroz, frijoles, aceite, azucar, sal y mas",
                "Bebidas: refrescos, jugos, agua, cerveza y licores",
                "Snacks: papas, galletas, dulces y botanas",
                "Limpieza: detergentes, jabones, cloro y desinfectantes",
              ].map((text) => (
                <li
                  key={text}
                  className="flex gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm ring-1 ring-border/40"
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
                  <span className="text-sm leading-relaxed text-foreground">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Flow */}
        <section id="flujo" className="scroll-mt-24 py-20" aria-labelledby="flujo-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="flujo-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Como funciona
            </h2>
            <p className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Simple, rapido y confiable
            </p>
            <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s) => (
                <li key={s.n}>
                  <article className="group relative h-full rounded-2xl border border-border bg-card p-6 shadow-sm ring-1 ring-border/30 transition-all duration-300 hover:border-accent/30 hover:shadow-lg hover:-translate-y-1">
                    <span className="font-mono text-xs font-medium text-accent">{s.n}</span>
                    <h3 className="mt-3 text-lg font-semibold text-foreground">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
                  </article>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pillars */}
        <section
          id="pilares"
          className="scroll-mt-24 border-t border-border/60 bg-muted/30 py-20"
          aria-labelledby="pilares-title"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="pilares-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Beneficios
            </h2>
            <p className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Todo lo que necesitas para crecer
            </p>
            <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {pillars.map(({ icon: Icon, title, body }) => (
                <li key={title}>
                  <article className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-all duration-300 hover:border-accent/35 hover:shadow-xl hover:-translate-y-1">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition-transform duration-300 group-hover:scale-105">
                      <Icon className="h-5 w-5" aria-hidden />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-foreground">{title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Trust */}
        <section className="py-20" aria-labelledby="confianza-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
              <div>
                <h2 id="confianza-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                  Seguridad y control
                </h2>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Tu negocio protegido en todo momento
                </p>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                  Acceso seguro con credenciales, respaldo automatico de datos y control total sobre quien puede ver y modificar informacion.
                </p>
              </div>
              <div className="grid gap-4">
                <div className="flex gap-4 rounded-2xl border border-border bg-card p-5 ring-1 ring-border/40">
                  <Lock className="h-6 w-6 shrink-0 text-accent" aria-hidden />
                  <div>
                    <h3 className="font-semibold text-foreground">Acceso protegido</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Solo usuarios autorizados pueden acceder al sistema.</p>
                  </div>
                </div>
                <div className="flex gap-4 rounded-2xl border border-border bg-card p-5 ring-1 ring-border/40">
                  <ShieldCheck className="h-6 w-6 shrink-0 text-accent" aria-hidden />
                  <div>
                    <h3 className="font-semibold text-foreground">Datos respaldados</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Sincronizacion automatica para nunca perder informacion.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 border-t border-border/60 bg-muted/30 py-20" aria-labelledby="faq-title">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 id="faq-title" className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              Preguntas frecuentes
            </h2>
            <p className="mt-3 text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Resolvemos tus dudas
            </p>
            <div className="mt-12 space-y-3">
              {faqs.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl border border-border bg-card px-5 py-1 shadow-sm ring-1 ring-border/40 open:pb-4 open:shadow-md"
                >
                  <summary className="cursor-pointer list-none py-4 text-sm font-semibold text-foreground outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between gap-3">
                      {item.q}
                      <span className="text-muted-foreground transition-transform duration-200 group-open:rotate-45" aria-hidden>
                        +
                      </span>
                    </span>
                  </summary>
                  <p className="border-t border-border/50 pt-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-4 pb-24 pt-4 sm:px-6" aria-labelledby="cta-final-title">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-accent/15 via-card to-card px-8 py-14 text-center shadow-2xl ring-1 ring-border sm:px-16 sm:py-16">
            <h2 id="cta-final-title" className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Comienza a gestionar tu tienda hoy
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
              Accede al panel administrativo para controlar ventas, inventario y analizar el rendimiento de tu negocio.
            </p>
            <Link
              href="/admin/login"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-sm font-semibold text-accent-foreground shadow-lg ring-1 ring-accent/40 transition-all hover:shadow-xl hover:-translate-y-0.5"
            >
              Acceder al panel
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 text-center sm:flex-row sm:px-6 sm:text-left">
          <div>
            <p className="text-sm font-semibold text-foreground">Tienda Luna</p>
            <p className="mt-1 text-xs text-muted-foreground">Sistema POS para tiendas de productos varios</p>
          </div>
          <nav aria-label="Pie" className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <a href="#categorias" className="transition-colors hover:text-foreground">
              Categorias
            </a>
            <a href="#flujo" className="transition-colors hover:text-foreground">
              Como funciona
            </a>
            <a href="#pilares" className="transition-colors hover:text-foreground">
              Beneficios
            </a>
            <Link href="/admin/login" className="font-medium text-accent transition-colors hover:text-foreground">
              Admin
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
