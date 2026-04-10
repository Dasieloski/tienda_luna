import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-24 dark:bg-zinc-950">
      <div className="max-w-lg text-center">
        <p className="text-sm font-medium text-violet-600 dark:text-violet-400">Tienda Luna</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          POS offline-first · núcleo SaaS multi-tienda
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          Sincronización por lotes, event sourcing en PostgreSQL, validación de stock en servidor y
          detección básica de fraude. La app cliente envía eventos; el backend decide qué es válido.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/admin/login"
            className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Panel admin
          </Link>
          <a
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            href="https://supabase.com/docs/guides/database/connecting-to-postgres"
            target="_blank"
            rel="noreferrer"
          >
            Conectar Supabase
          </a>
        </div>
      </div>
    </div>
  );
}
