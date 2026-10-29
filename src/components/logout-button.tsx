import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth/actions";

export function LogoutButton({
  variant = "outline",
  label = "Keluar",
}: {
  variant?: "outline" | "ghost" | "default";
  label?: string;
}) {
  return (
    <form action={logout}>
      <Button type="submit" variant={variant} size="sm">
        <LogOutIcon />
        {label}
      </Button>
    </form>
  );
}
