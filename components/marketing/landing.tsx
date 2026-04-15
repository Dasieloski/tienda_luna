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
  Sparkles,
  Store,
  Workflow,
} from "lucide-react";
import Link from "next/link";

const pillars = [
  {
    icon: CloudOff,
    title: "Offline-first real",
    body: "Caja y almacén siguen vendiendo sin conexión. Los eventos quedan en cola con orden e idempotencia hasta el próximo lote.",
  },
  {
    icon: Workflow,
    title: "Sincronización por lotes",
    body: "Envíos batch con reintentos seguros: menos ruido en red, más control sobre el ritmo de integración con el núcleo.",
  },
  {
    icon: ShieldCheck,
    title: "Validación en el núcleo",
    body: "Stock, reglas y políticas se aplican donde debe ser: un solo lugar de verdad, sin carreras entre dispositivos.",
  },
  {
    icon: Radar,
    title: "Señales operativas",
    body: "Marcadores de anomalías y fraude básico para priorizar revisión humana sin frenar la operación diaria.",
  },
  {
    icon: BarChart3,
    title: "Panel ejecutivo",
    body: "Ventas, inventario, cohortes y auditoría de eventos en un flujo de lectura claro para dueños y operaciones.",
  },
  {
    icon: Layers3,
    title: "Event sourcing",
    body: "Trazabilidad de lo ocurrido en tienda: qué pasó, cuándo y desde qué dispositivo, listo para informes y mejora continua.",
  },
] as const;

const steps = [
  { n: "01", title: "Venta en tienda", desc: "El POS registra líneas, pagos y movimientos aunque la red falle." },
  { n: "02", title: "Cola de eventos", desc: "Cada acción se empaqueta como evento ordenado y listo para enviar." },
  { n: "03", title: "Lote al núcleo", desc: "El backend recibe lotes, deduplica y aplica reglas de negocio." },
  { n: "04", title: "Stock y métricas", desc: "Inventario actualizado y dashboard alineado con la verdad del servidor." },
] as const;

const faqs = [
  {
    q: "¿Qué es Tienda Luna?",
    a: "Un núcleo POS pensado para retail multi‑punto: offline‑first, sincronización por lotes y panel admin con métricas y auditoría.",
  },
  {
    q: "¿Por qué event sourcing?",
    a: "Porque conservas el historial de lo que ocurrió en tienda, facilitando soporte, cumplimiento y evolución del modelo sin perder contexto.",
  },
  {
    q: "¿Quién valida el stock?",
    a: "El servidor. Los dispositivos proponen; el núcleo confirma o rechaza según reglas, evitando inconsistencias entre cajas.",
  },
] as const;

export function Landing() {
  return (
    <>
      <div className="tl-aurora" aria-hidden />
      <div className="tl-noise" aria-hidden />

      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-tl-accent focus:px-4 focus:py-2 focus:text-tl-accent-fg"
      >
        Saltar al contenido
      </a>

      <header className="sticky top-0 z-50 border-b border-tl-line/50 bg-tl-canvas/70 shadow-sm shadow-tl-accent/5 backdrop-blur-2xl">
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-tl-accent/35 to-transparent" />
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="group flex items-center gap-3 rounded-2xl py-1 pr-2 transition-colors hover:bg-tl-line/20"
          >
            <span className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-tl-accent to-violet-600 text-tl-accent-fg shadow-md ring-2 ring-tl-line/60 transition-transform duration-300 group-hover:scale-[1.03]">
              <Sparkles className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              <span className="absolute inset-0 bg-gradient-to-t from-black/15 to-transparent" aria-hidden />
            </span>
            <span className="text-sm font-bold tracking-tight text-tl-ink">Tienda Luna</span>
          </Link>
          <nav
            aria-label="Principal"
            className="hidden items-center gap-1 rounded-full border border-tl-line/60 bg-tl-canvas/50 p-1 shadow-inner md:flex"
          >
            <a
              href="#producto"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-tl-muted transition-all hover:bg-tl-line/50 hover:text-tl-ink"
            >
              <Package className="h-3.5 w-3.5 text-tl-accent" aria-hidden />
              Producto
            </a>
            <a
              href="#flujo"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-tl-muted transition-all hover:bg-tl-line/50 hover:text-tl-ink"
            >
              <Workflow className="h-3.5 w-3.5 text-tl-accent" aria-hidden />
              Flujo
            </a>
            <a
              href="#pilares"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-tl-muted transition-all hover:bg-tl-line/50 hover:text-tl-ink"
            >
              <Layers3 className="h-3.5 w-3.5 text-tl-accent" aria-hidden />
              Pilares
            </a>
            <a
              href="#faq"
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-tl-muted transition-all hover:bg-tl-line/50 hover:text-tl-ink"
            >
              <HelpCircle className="h-3.5 w-3.5 text-tl-accent" aria-hidden />
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/login"
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-tl-accent to-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-tl-accent/25 ring-1 ring-white/20 transition-[transform,box-shadow] hover:shadow-xl motion-safe:hover:-translate-y-0.5 sm:text-sm"
            >
              Panel admin
              <LayoutDashboard className="h-4 w-4 opacity-95" aria-hidden />
            </Link>
          </div>
        </div>
        <div className="border-t border-tl-line/40 bg-tl-canvas/55 md:hidden">
          <nav
            aria-label="Secciones"
            className="mx-auto flex max-w-6xl flex-wrap justify-center gap-1 px-2 py-2.5"
          >
            {(
              [
                ["#producto", "Producto", Package],
                ["#flujo", "Flujo", Workflow],
                ["#pilares", "Pilares", Layers3],
                ["#faq", "FAQ", HelpCircle],
              ] as const
            ).map(([href, label, Icon]) => (
              <a
                key={href}
                href={href}
                className="inline-flex items-center gap-1 rounded-full border border-tl-line/50 bg-tl-canvas/80 px-2.5 py-1.5 text-[11px] font-semibold text-tl-muted shadow-sm hover:border-tl-accent/30 hover:text-tl-ink"
              >
                <Icon className="h-3 w-3 text-tl-accent" aria-hidden />
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main id="contenido-principal">
        {/* Hero */}
        <section
          className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20"
          aria-labelledby="hero-title"
        >
          <div className="grid items-center gap-14 lg:grid-cols-[1fr_minmax(0,420px)] lg:gap-12">
            <div>
              <p className="tl-reveal inline-flex items-center gap-2 rounded-full border border-tl-line bg-tl-canvas/85 px-3 py-1.5 text-xs font-medium text-tl-muted shadow-sm backdrop-blur">
                <Store className="h-3.5 w-3.5 text-tl-accent" aria-hidden />
                Retail · POS · operación centralizada
              </p>
              <h1
                id="hero-title"
                className="tl-reveal tl-delay-1 mt-6 text-4xl font-semibold tracking-tight text-balance text-tl-ink sm:text-5xl sm:leading-[1.06] lg:text-[3.25rem]"
              >
                El ritmo de tu tienda, orquestado con precisión
              </h1>
              <p className="tl-reveal tl-delay-2 mt-5 max-w-xl text-lg leading-relaxed text-pretty text-tl-muted sm:text-xl">
                Un núcleo comercial que no se detiene cuando cae la red: ventas, colas de eventos, validación en servidor y un
                panel que habla el idioma del negocio.
              </p>
              <div className="tl-reveal tl-delay-3 mt-10 flex flex-wrap items-center gap-3">
                <Link
                  href="/admin/login"
                  className="inline-flex items-center gap-2 rounded-full bg-tl-ink px-6 py-3 text-sm font-semibold text-tl-canvas shadow-lg ring-1 ring-tl-ink/15 transition-[transform,box-shadow] hover:shadow-xl motion-safe:hover:-translate-y-0.5"
                >
                  Ver el panel
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a
                  href="#producto"
                  className="inline-flex items-center gap-2 rounded-full border border-tl-line bg-tl-canvas/70 px-6 py-3 text-sm font-medium text-tl-ink backdrop-blur transition-[transform,background-color] hover:bg-tl-line/35 motion-safe:hover:-translate-y-0.5"
                >
                  Cómo funciona
                </a>
              </div>
            </div>

            <div className="tl-reveal tl-delay-4">
              <div
                className="tl-float relative overflow-hidden rounded-3xl border border-tl-line bg-tl-canvas/70 p-1 shadow-2xl shadow-tl-accent/10 ring-1 ring-tl-line/80 backdrop-blur-xl"
                role="img"
                aria-label="Resumen visual: tienda, lote de sincronización y núcleo de validación"
              >
                <div className="rounded-[1.35rem] bg-gradient-to-br from-tl-line/45 via-transparent to-tl-accent/12 p-6 sm:p-8">
                  <div className="grid gap-4">
                    <div className="rounded-2xl border border-tl-line/80 bg-tl-canvas/85 p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-tl-muted">Punto de venta</p>
                      <p className="mt-2 text-sm font-medium text-tl-ink">Cola local activa</p>
                      <p className="mt-1 text-xs text-tl-muted">Ventas y ajustes con continuidad operativa</p>
                    </div>
                    <div className="rounded-2xl border border-tl-accent/35 bg-tl-accent/10 p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-tl-accent">Lote de sync</p>
                      <p className="mt-2 text-sm font-medium text-tl-ink">Idempotencia y orden</p>
                      <p className="mt-1 text-xs text-tl-muted">Reintentos sin duplicar efectos</p>
                    </div>
                    <div className="rounded-2xl border border-tl-line/80 bg-tl-canvas/85 p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-tl-muted">Núcleo</p>
                      <p className="mt-2 text-sm font-medium text-tl-ink">Stock · reglas · auditoría</p>
                      <p className="mt-1 text-xs text-tl-muted">Una sola fuente de verdad</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Cifras / prueba social ligera */}
          <dl className="tl-reveal tl-delay-5 mt-16 grid gap-6 border-t border-tl-line/50 pt-12 sm:grid-cols-3">
            <div className="text-center sm:text-left">
              <dt className="text-xs font-medium uppercase tracking-wider text-tl-muted">Modelo</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-tl-ink">Offline‑first</dd>
              <dd className="mt-1 text-sm text-tl-muted">Sin parar la caja</dd>
            </div>
            <div className="text-center sm:text-left">
              <dt className="text-xs font-medium uppercase tracking-wider text-tl-muted">Sincronización</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-tl-ink">Por lotes</dd>
              <dd className="mt-1 text-sm text-tl-muted">Eficiente y trazable</dd>
            </div>
            <div className="text-center sm:text-left">
              <dt className="text-xs font-medium uppercase tracking-wider text-tl-muted">Gobernanza</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-tl-ink">En servidor</dd>
              <dd className="mt-1 text-sm text-tl-muted">Reglas centralizadas</dd>
            </div>
          </dl>
        </section>

        {/* Producto */}
        <section
          id="producto"
          className="scroll-mt-24 border-t border-tl-line/60 bg-tl-line/12 py-20"
          aria-labelledby="producto-title"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 id="producto-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-tl-accent">
                Qué construimos
              </h2>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-tl-ink sm:text-4xl">
                Un sistema operativo comercial para cadenas que no pueden permitirse silos
              </p>
              <p className="mt-4 text-base leading-relaxed text-tl-muted sm:text-lg">
                Tienda Luna une la experiencia en mostrador con la disciplina de un backend transaccional: cada venta es un
                evento, cada lote es un contrato, y el panel admin traduce datos en decisiones.
              </p>
            </div>
            <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                "Cajas y almacenes desacoplados del estado frágil de la red.",
                "Historial completo para soporte, auditoría y mejora de procesos.",
                "Métricas por hora, producto, dispositivo y cliente frecuente.",
                "Alertas de inventario y lectura de anomalías sin ruido innecesario.",
              ].map((text) => (
                <li
                  key={text}
                  className="flex gap-3 rounded-2xl border border-tl-line bg-tl-canvas/75 p-5 shadow-sm ring-1 ring-tl-line/40"
                >
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-tl-accent" aria-hidden />
                  <span className="text-sm leading-relaxed text-tl-ink">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Flujo */}
        <section id="flujo" className="scroll-mt-24 py-20" aria-labelledby="flujo-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="flujo-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-tl-accent">
              Flujo operativo
            </h2>
            <p className="mt-3 max-w-xl text-3xl font-semibold tracking-tight text-tl-ink sm:text-4xl">
              De la caja al núcleo, sin perder el hilo
            </p>
            <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s) => (
                <li key={s.n}>
                  <article className="group relative h-full rounded-2xl border border-tl-line bg-tl-canvas/60 p-6 shadow-sm ring-1 ring-tl-line/30 transition-[border-color,box-shadow,transform] duration-300 hover:border-tl-accent/30 hover:shadow-lg motion-safe:hover:-translate-y-1">
                    <span className="font-mono text-xs font-medium text-tl-accent">{s.n}</span>
                    <h3 className="mt-3 text-lg font-semibold text-tl-ink">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-tl-muted">{s.desc}</p>
                  </article>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pilares */}
        <section
          id="pilares"
          className="scroll-mt-24 border-t border-tl-line/60 bg-tl-line/10 py-20"
          aria-labelledby="pilares-title"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 id="pilares-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-tl-accent">
              Pilares
            </h2>
            <p className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-tl-ink sm:text-4xl">
              Diseño de plataforma, no parches en el mostrador
            </p>
            <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {pillars.map(({ icon: Icon, title, body }) => (
                <li key={title}>
                  <article className="group flex h-full flex-col rounded-2xl border border-tl-line bg-tl-canvas/80 p-6 shadow-sm transition-[transform,box-shadow,border-color] duration-300 hover:border-tl-accent/35 hover:shadow-xl motion-safe:hover:-translate-y-1">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-tl-accent/12 text-tl-accent ring-1 ring-tl-accent/20 transition-transform duration-300 group-hover:scale-105">
                      <Icon className="h-5 w-5" aria-hidden />
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-tl-ink">{title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-tl-muted">{body}</p>
                  </article>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Confianza */}
        <section className="py-20" aria-labelledby="confianza-title">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
              <div>
                <h2 id="confianza-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-tl-accent">
                  Criterio y control
                </h2>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-tl-ink sm:text-4xl">
                  Seguridad operativa sin convertir la tienda en un laboratorio
                </p>
                <p className="mt-4 text-base leading-relaxed text-tl-muted">
                  El modelo separa lo que puede hacer un dispositivo de lo que debe decidir el núcleo. Así reduces fricción en
                  tienda y mantienes límites claros donde importa.
                </p>
              </div>
              <div className="grid gap-4">
                <div className="flex gap-4 rounded-2xl border border-tl-line bg-tl-canvas/70 p-5 ring-1 ring-tl-line/40">
                  <Lock className="h-6 w-6 shrink-0 text-tl-accent" aria-hidden />
                  <div>
                    <h3 className="font-semibold text-tl-ink">Acceso administrativo acotado</h3>
                    <p className="mt-1 text-sm text-tl-muted">Panel y APIs pensados para sesiones explícitas y trazabilidad.</p>
                  </div>
                </div>
                <div className="flex gap-4 rounded-2xl border border-tl-line bg-tl-canvas/70 p-5 ring-1 ring-tl-line/40">
                  <ShieldCheck className="h-6 w-6 shrink-0 text-tl-accent" aria-hidden />
                  <div>
                    <h3 className="font-semibold text-tl-ink">Fraude como señal, no como show</h3>
                    <p className="mt-1 text-sm text-tl-muted">Marcadores para revisar sin bloquear ventas legítimas.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-24 border-t border-tl-line/60 bg-tl-line/12 py-20" aria-labelledby="faq-title">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 id="faq-title" className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-tl-accent">
              Preguntas frecuentes
            </h2>
            <p className="mt-3 text-center text-3xl font-semibold tracking-tight text-tl-ink sm:text-4xl">
              Antes de entrar al panel
            </p>
            <div className="mt-12 space-y-3">
              {faqs.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl border border-tl-line bg-tl-canvas/80 px-5 py-1 shadow-sm ring-1 ring-tl-line/40 open:pb-4 open:shadow-md"
                >
                  <summary className="cursor-pointer list-none py-4 text-sm font-semibold text-tl-ink outline-none marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center justify-between gap-3">
                      {item.q}
                      <span className="text-tl-muted transition-transform duration-200 group-open:rotate-45" aria-hidden>
                        +
                      </span>
                    </span>
                  </summary>
                  <p className="border-t border-tl-line/50 pt-3 text-sm leading-relaxed text-tl-muted">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="mx-auto max-w-6xl px-4 pb-24 pt-4 sm:px-6" aria-labelledby="cta-final-title">
          <div className="relative overflow-hidden rounded-3xl border border-tl-line bg-gradient-to-br from-tl-accent/18 via-tl-canvas to-tl-canvas px-8 py-14 text-center shadow-2xl ring-1 ring-tl-line/60 sm:px-16 sm:py-16">
            <h2 id="cta-final-title" className="text-2xl font-semibold tracking-tight text-tl-ink sm:text-3xl">
              Opera con la misma exigencia que diseñas tu marca
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-tl-muted sm:text-base">
              Entra al panel admin para ver métricas, inventario y el pulso de eventos de tu operación.
            </p>
            <Link
              href="/admin/login"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-tl-accent px-7 py-3.5 text-sm font-semibold text-tl-accent-fg shadow-lg ring-1 ring-tl-accent/40 transition-[transform,box-shadow] hover:shadow-xl motion-safe:hover:-translate-y-0.5"
            >
              Abrir panel admin
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-tl-line/60 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 text-center sm:flex-row sm:px-6 sm:text-left">
          <div>
            <p className="text-sm font-semibold text-tl-ink">Tienda Luna</p>
            <p className="mt-1 text-xs text-tl-muted">POS offline‑first · núcleo multi‑tienda</p>
          </div>
          <nav aria-label="Pie" className="flex flex-wrap items-center justify-center gap-4 text-xs text-tl-muted">
            <a href="#producto" className="transition-colors hover:text-tl-ink">
              Producto
            </a>
            <a href="#flujo" className="transition-colors hover:text-tl-ink">
              Flujo
            </a>
            <a href="#pilares" className="transition-colors hover:text-tl-ink">
              Pilares
            </a>
            <Link href="/admin/login" className="font-medium text-tl-accent transition-colors hover:text-tl-ink">
              Admin
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}
