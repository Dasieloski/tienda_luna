import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";
import { backfillSnapshots } from "@/services/snapshot-service";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function parseUtcYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session || !requireAdmin(session)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (session.storeId === LOCAL_ADMIN_STORE_ID) {
    return NextResponse.json({ error: "DB_NOT_AVAILABLE" }, { status: 400 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_QUERY" }, { status: 400 });
  }

  const from = parseUtcYmd(parsed.data.from);
  const to = parseUtcYmd(parsed.data.to);
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: "INVALID_RANGE" }, { status: 400 });
  }

  const spanDays = Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1;
  if (spanDays > 400) {
    return NextResponse.json({ error: "RANGE_TOO_LONG", maxDays: 400 }, { status: 400 });
  }

  const result = await backfillSnapshots(session.storeId, from, to);
  return NextResponse.json(result);
}

