import { NextResponse } from "next/server";
import { getSessionFromRequest, requireAdmin } from "@/lib/auth";
import { emptyOverviewPayload, getOverview } from "@/services/analytics-service";

export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session || !requireAdmin(session)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const overview = await getOverview(session.storeId);
    return NextResponse.json(overview);
  } catch (err) {
    console.error("[api/stats/overview]", err);
    const now = new Date();
    return NextResponse.json({
      ...emptyOverviewPayload(now),
      meta: {
        dbAvailable: false,
        message:
          err instanceof Error
            ? err.message
            : "Error al cargar métricas; revisa DATABASE_URL y la conexión a Supabase.",
      },
    });
  }
}
