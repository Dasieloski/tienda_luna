"use client"

import {
  ArrowRightIcon as ArrowRight,
  BarChart3Icon as BarChart3,
  CheckCircle2Icon as CheckCircle2,
  CloudOffIcon as CloudOff,
  HelpCircleIcon as HelpCircle,
  Layers3Icon as Layers3,
  LayoutDashboardIcon as LayoutDashboard,
  LockIcon as Lock,
  PackageIcon as Package,
  RadarIcon as Radar,
  ShieldCheckIcon as ShieldCheck,
  ShoppingBagIcon as ShoppingBag,
  SparklesIcon as Sparkles,
  StoreIcon as Store,
  WorkflowIcon as Workflow,
} from "@/components/ui/icons"
import Link from "next/link"
import { cn } from "@/lib/utils"

const NAV_LINKS = [
  { href: "#categorias", label: "Categorias", Icon: Package },
  { href: "#flujo", label: "Como funciona", Icon: Workflow },
  { href: "#pilares", label: "Beneficios", Icon: Layers3 },
  { href: "#faq", label: "FAQ", Icon: HelpCircle },
] as const

const TL_STAGGER = [
  "tl-delay-1",
  "tl-delay-2",
  "tl-delay-3",
  "tl-delay-4",
  "tl-delay-5",
  "tl-delay-6",
] as const

function staggerReveal(index: number) {
  return cn("tl-reveal", TL_STAGGER[index % TL_STAGGER.length])
}

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
        <div className="absolute -bottom-[20%] -right-[10%] h-[50%] w-[40%] rounded-full bg-tl-secondary/8 blur-[100px]" />
      </div>

      {/* Noise texture */}
      <div 
        className="pointer-events-none fixed inset-0 opacity-[0.015]" 
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")" }}
        aria-hidden 
      />

      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--tl-radius-sm)] focus:bg-tl-accent focus:px-4 focus:py-2 focus:text-tl-accent-fg focus:outline-none"
      >
        Saltar al contenido
      </a>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-tl-line-subtle bg-tl-canvas-inset/92 shadow-[var(--tl-shadow-sm)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="group flex items-center gap-3 rounded-2xl py-1.5 pr-3 transition-colors hover:bg-tl-canvas-subtle"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-tl-accent text-tl-accent-fg shadow-[var(--tl-shadow-sm)] transition-transform duration-200 group-hover:scale-[1.02]">
              <ShoppingBag className="h-5 w-5" strokeWidth={2} aria-hidden />
            </span>
            <span className="text-base font-bold tracking-tight text-tl-ink">Tienda Luna</span>
          </Link>
          
          <nav
            aria-label="Principal"
            className="hidden items-center gap-2 md:flex"
          >
            {NAV_LINKS.map(({ href, label, Icon }) => (
              <a
                key={href}
                href={href}
                className={cn(
                  "tl-nav-pill inline-flex items-center gap-2 !px-3 !py-2 !text-xs font-semibold",
                  "text-tl-muted hover:text-tl-ink"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-tl-accent" aria-hidden />
                {label}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/admin/login"
              className={cn(
                "tl-btn tl-btn-dark !gap-2 !px-4 !py-2 !text-xs sm:!text-sm",
                "no-underline"
              )}
            >
              Panel admin
              <LayoutDashboard className="h-4 w-4 shrink-0 opacity-95" aria-hidden />
            </Link>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="border-t border-tl-line-subtle bg-tl-canvas-subtle/80 md:hidden">
          <nav
            aria-label="Secciones"
            className="mx-auto grid max-w-6xl grid-cols-2 gap-2 px-3 py-3 sm:flex sm:flex-wrap sm:justify-center"
          >
            {NAV_LINKS.map(({ href, label, Icon }) => (
              <a
                key={href}
                href={href}
                className={cn(
                  "tl-nav-pill inline-flex items-center gap-1.5 !px-3 !py-1.5 !text-[11px] font-semibold",
                  "text-tl-muted hover:text-tl-ink"
                )}
              >
                <Icon className="h-3 w-3 shrink-0 text-tl-accent" aria-hidden />
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main id="contenido-principal" className="relative">
        {/* Hero */}
        <section
          className="relative mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-16 lg:pb-24 lg:pt-20"
          aria-labelledby="hero-title"
        >
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_minmax(0,420px)] lg:gap-12">
            <div>
              <p
                className={cn(
                  "tl-reveal tl-delay-1 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur"
                )}
              >
                <Store className="h-3.5 w-3.5 text-accent" aria-hidden />
                Tu tienda de productos varios
              </p>
              <h1
                id="hero-title"
                className="tl-reveal tl-delay-2 mt-6 text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl sm:leading-[1.06] lg:text-[3.25rem]"
              >
                Gestiona tu tienda con la precision que merece
              </h1>
              <p className="tl-reveal tl-delay-3 mt-5 max-w-xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-xl">
                Sistema de punto de venta disenado para tiendas de productos varios. Controla inventario, registra ventas y analiza tu negocio desde cualquier lugar.
              </p>
              <div className="tl-reveal tl-delay-4 mt-10 flex flex-wrap items-center gap-3">
                <Link
                  href="/admin/login"
                  className={cn("tl-btn tl-btn-dark !gap-2 no-underline")}
                >
                  Iniciar sesion
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a
                  href="#categorias"
                  className={cn("tl-btn tl-btn-secondary !gap-2 no-underline")}
                >
                  Ver categorias
                </a>
              </div>
            </div>

            {/* Hero visual */}
            <div className="tl-reveal tl-delay-5">
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
          <dl className="mt-16 grid gap-6 border-t border-border/50 pt-12 sm:grid-cols-3">
            <div className={cn("text-center sm:text-left", staggerReveal(0))}>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Disponibilidad</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">99.9%</dd>
              <dd className="mt-1 text-sm text-muted-foreground">Funciona offline</dd>
            </div>
            <div className={cn("text-center sm:text-left", staggerReveal(1))}>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Transacciones</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">Ilimitadas</dd>
              <dd className="mt-1 text-sm text-muted-foreground">Sin restricciones</dd>
            </div>
            <div className={cn("text-center sm:text-left", staggerReveal(2))}>
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
            <div className={cn("max-w-2xl", "tl-reveal tl-delay-1")}>
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
              {categories.map(({ name, icon: Icon }, i) => (
                <div
                  key={name}
                  className={cn(
                    "group tl-card-hover flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm ring-1 ring-border/40 transition-shadow duration-200 hover:border-accent/30 hover:shadow-lg",
                    staggerReveal(i)
                  )}
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition-transform duration-200 ease-out group-hover:scale-105">
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
              ].map((text, i) => (
                <li
                  key={text}
                  className={cn(
                    "tl-card-hover flex gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm ring-1 ring-border/40 transition-shadow duration-200 hover:shadow-md",
                    staggerReveal(i + 2)
                  )}
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
            <div className={cn("tl-reveal tl-delay-1")}>
              <h2 id="flujo-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Como funciona
              </h2>
              <p className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Simple, rapido y confiable
              </p>
            </div>
            <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <li key={s.n}>
                  <article
                    className={cn(
                      "group tl-card-hover relative h-full rounded-2xl border border-border bg-card p-6 shadow-sm ring-1 ring-border/30 transition-shadow duration-200 hover:border-accent/30 hover:shadow-lg",
                      staggerReveal(i)
                    )}
                  >
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
            <div className={cn("tl-reveal tl-delay-1")}>
              <h2 id="pilares-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Beneficios
              </h2>
              <p className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Todo lo que necesitas para crecer
              </p>
            </div>
            <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {pillars.map(({ icon: Icon, title, body }, i) => (
                <li key={title}>
                  <article
                    className={cn(
                      "group tl-card-hover flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-shadow duration-200 hover:border-accent/35 hover:shadow-xl",
                      staggerReveal(i)
                    )}
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition-transform duration-200 ease-out group-hover:scale-105">
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
              <div className={cn("tl-reveal tl-delay-1")}>
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
                <div
                  className={cn(
                    "tl-card-hover flex gap-4 rounded-2xl border border-border bg-card p-5 ring-1 ring-border/40 transition-shadow duration-200 hover:shadow-md",
                    staggerReveal(1)
                  )}
                >
                  <Lock className="h-6 w-6 shrink-0 text-accent" aria-hidden />
                  <div>
                    <h3 className="font-semibold text-foreground">Acceso protegido</h3>
                    <p className="mt-1 text-sm text-muted-foreground">Solo usuarios autorizados pueden acceder al sistema.</p>
                  </div>
                </div>
                <div
                  className={cn(
                    "tl-card-hover flex gap-4 rounded-2xl border border-border bg-card p-5 ring-1 ring-border/40 transition-shadow duration-200 hover:shadow-md",
                    staggerReveal(2)
                  )}
                >
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
            <div className={cn("tl-reveal tl-delay-1 text-center")}>
              <h2 id="faq-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
                Preguntas frecuentes
              </h2>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Resolvemos tus dudas
              </p>
            </div>
            <div className="mt-12 space-y-3">
              {faqs.map((item, i) => (
                <details
                  key={item.q}
                  className={cn(
                    "group rounded-2xl border border-border bg-card px-5 py-1 shadow-sm ring-1 ring-border/40 transition-shadow duration-200 hover:shadow-md open:pb-4 open:shadow-md",
                    staggerReveal(i + 1)
                  )}
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
          <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-accent/15 via-card to-card px-5 py-10 text-center shadow-2xl ring-1 ring-border sm:px-10 sm:py-14 lg:px-16 lg:py-16">
            <h2
              id="cta-final-title"
              className={cn("tl-reveal tl-delay-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl")}
            >
              Comienza a gestionar tu tienda hoy
            </h2>
            <p className={cn("tl-reveal tl-delay-2 mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base")}>
              Accede al panel administrativo para controlar ventas, inventario y analizar el rendimiento de tu negocio.
            </p>
            <Link
              href="/admin/login"
              className={cn("tl-btn tl-btn-primary tl-reveal tl-delay-3 mt-8 !gap-2 no-underline")}
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
            <Link
              href="/admin/login"
              className="tl-nav-pill !px-3 !py-1.5 !text-xs font-semibold text-tl-muted no-underline hover:text-tl-ink"
            >
              Admin
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
