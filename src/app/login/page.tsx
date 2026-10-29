import type { Metadata } from "next";

import { ModulePlaceholder } from "@/components/module-placeholder";

export const metadata: Metadata = { title: "Login" };

export default function LoginPage() {
  return (
    <ModulePlaceholder
      title="Login Staff"
      description="Login untuk barista, kasir, admin, dan manager."
      features={["Email + password via Supabase Auth", "Akses sesuai role & permission"]}
    />
  );
}
