-- Tienda Luna: Snapshots diarios de métricas (MetricSnapshot) con pg_cron.
--
-- Requisitos:
-- - Tabla "MetricSnapshot" creada via Prisma migrate/db push.
-- - Extensión pg_cron habilitada en Supabase (según plan).
--
-- Nota:
-- - `day` se guarda como timestamptz a las 00:00:00Z del día.
-- - Este script calcula métricas por tienda y hace upsert idempotente.

-- 1) Función: upsert snapshot para una tienda y un día.
create or replace function public.tl_upsert_metric_snapshot(store_id text, day_utc date)
returns void
language plpgsql
as $$
declare
  day_start timestamptz := (day_utc::timestamptz);
  day_end   timestamptz := (day_utc::timestamptz + interval '1 day');
  revenue_cents bigint := 0;
  sale_count bigint := 0;
  ticket_avg_cents bigint := 0;
  margin_revenue bigint := 0;
  margin_cost bigint := 0;
  lines_with_cost bigint := 0;
  lines_without_cost bigint := 0;
  margin_cents bigint := 0;
  margin_pct double precision := null;
  payment_mix jsonb := '[]'::jsonb;
begin
  select
    coalesce(sum(s."totalCents"), 0)::bigint,
    count(*)::bigint
  into revenue_cents, sale_count
  from "Sale" s
  where s."storeId" = store_id
    and s."status" = 'COMPLETED'
    and s."completedAt" >= day_start
    and s."completedAt" < day_end;

  if sale_count > 0 then
    ticket_avg_cents := round(revenue_cents::numeric / sale_count::numeric)::bigint;
  end if;

  select
    coalesce(sum(case when p."costCents" is not null then sl."subtotalCents" else 0 end), 0)::bigint as rev,
    coalesce(sum(case when p."costCents" is not null then p."costCents" * sl."quantity" else 0 end), 0)::bigint as cost,
    coalesce(sum(case when p."costCents" is not null then 1 else 0 end), 0)::bigint as l_with,
    coalesce(sum(case when p."costCents" is null then 1 else 0 end), 0)::bigint as l_without
  into margin_revenue, margin_cost, lines_with_cost, lines_without_cost
  from "SaleLine" sl
  inner join "Sale" s on s."id" = sl."saleId"
  inner join "Product" p on p."id" = sl."productId"
  where s."storeId" = store_id
    and s."status" = 'COMPLETED'
    and s."completedAt" >= day_start
    and s."completedAt" < day_end;

  margin_cents := margin_revenue - margin_cost;
  if margin_revenue > 0 then
    margin_pct := (margin_cents::double precision / margin_revenue::double precision) * 100.0;
  end if;

  select coalesce(jsonb_agg(x order by (x->>'revenueCents')::bigint desc), '[]'::jsonb)
  into payment_mix
  from (
    select jsonb_build_object(
      'method', coalesce(nullif(trim(e.payload->>'paymentMethod'), ''), '(sin método)'),
      'revenueCents', coalesce(sum(s."totalCents"),0)::bigint,
      'sales', count(*)::bigint
    ) as x
    from "Event" e
    inner join "Sale" s on s."storeId" = e."storeId"
      and s."clientSaleId" = (e.payload->>'saleId')
    where e."storeId" = store_id
      and e."type" = 'SALE_COMPLETED'
      and e."status" in ('ACCEPTED','CORRECTED')
      and s."status" = 'COMPLETED'
      and s."completedAt" >= day_start
      and s."completedAt" < day_end
    group by 1
  ) t;

  insert into "MetricSnapshot" (
    "storeId",
    "day",
    "revenueCents",
    "saleCount",
    "ticketAvgCents",
    "marginCents",
    "marginPct",
    "linesWithCost",
    "linesWithoutCost",
    "paymentMix",
    "createdAt",
    "updatedAt"
  )
  values (
    store_id,
    date_trunc('day', day_start at time zone 'UTC') at time zone 'UTC',
    revenue_cents::int,
    sale_count::int,
    ticket_avg_cents::int,
    margin_cents::int,
    margin_pct,
    lines_with_cost::int,
    lines_without_cost::int,
    payment_mix,
    now(),
    now()
  )
  on conflict ("storeId","day") do update set
    "revenueCents" = excluded."revenueCents",
    "saleCount" = excluded."saleCount",
    "ticketAvgCents" = excluded."ticketAvgCents",
    "marginCents" = excluded."marginCents",
    "marginPct" = excluded."marginPct",
    "linesWithCost" = excluded."linesWithCost",
    "linesWithoutCost" = excluded."linesWithoutCost",
    "paymentMix" = excluded."paymentMix",
    "updatedAt" = now();
end;
$$;

-- 2) Función: generar snapshots para todas las tiendas para un día dado.
create or replace function public.tl_generate_metric_snapshots_for_all_stores(day_utc date)
returns void
language plpgsql
as $$
declare
  r record;
begin
  for r in select id from "Store" loop
    perform public.tl_upsert_metric_snapshot(r.id, day_utc);
  end loop;
end;
$$;

-- 3) Programación diaria (ajusta horario según tu zona; este ejemplo corre 04:05 UTC).
-- Descomenta para programar:
-- select cron.schedule(
--   'tl_metric_snapshots_daily',
--   '5 4 * * *',
--   $$select public.tl_generate_metric_snapshots_for_all_stores((current_date - 1));$$
-- );

