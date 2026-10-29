// Foto bukti stok keluar/waste: cek session + permission outlet, lalu
// redirect ke signed URL bucket privat yang berlaku 60 detik.

import { db } from "@/db";
import { AccessError } from "@/lib/auth/errors";
import { getCurrentUser } from "@/lib/auth/session";
import { evidenceUrl } from "@/lib/inventory/queries";
import { inventoryEvidenceStorage } from "@/lib/supabase/storage";

export async function GET(_request: Request, { params }: RouteContext<"/admin/inventory/evidence/[id]">) {
  const user = await getCurrentUser();
  if (!user || !user.isActive) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const url = await evidenceUrl(db, user, id, inventoryEvidenceStorage);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessError) {
      return new Response(error.code === "forbidden" ? "Forbidden" : "Not found", {
        status: error.code === "forbidden" ? 403 : 404,
      });
    }
    throw error;
  }
}
