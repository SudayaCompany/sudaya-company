"use server";

import { redirect } from "next/navigation";

import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";

import { getAuditContext, getCurrentUser } from "./session";

export async function logout() {
  const user = await getCurrentUser();
  if (user) {
    await recordAudit(
      db,
      {
        companyId: user.company.id,
        actorId: user.id,
        action: "auth.logout",
        entityType: "user",
        entityId: user.id,
      },
      await getAuditContext(),
    );
  }

  // scope local: hanya sesi perangkat ini (perangkat outlet lain tetap login).
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
