import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { LOCAL_ADMIN_STORE_ID } from "@/lib/static-admin-auth";

/**
 * Devuelve `storeId` (y datos mínimos de sesión) para configurar la APK
 * o verificar el tenant. Acepta cookie `tl_session` o `Authorization: Bearer`.
 */
export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const isPlaceholder = session.storeId === LOCAL_ADMIN_STORE_ID;

  if (session.typ === "device") {
    return NextResponse.json({
      typ: "device",
      storeId: session.storeId,
      deviceId: session.sub,
      isLocalStorePlaceholder: isPlaceholder,
    });
  }

  if (session.typ === "user") {
    return NextResponse.json({
      typ: "user",
      storeId: session.storeId,
      role: session.role ?? null,
      userId: session.sub,
      isLocalStorePlaceholder: isPlaceholder,
    });
  }

  return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
}
