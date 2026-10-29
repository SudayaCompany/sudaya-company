"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useActionToast } from "@/hooks/use-action-toast";

import { setRolePermissionAction } from "./actions";

export function PermissionToggle({
  roleId,
  roleName,
  permissionCode,
  granted,
  disabled,
}: {
  roleId: string;
  roleName: string;
  permissionCode: string;
  granted: boolean;
  disabled: boolean;
}) {
  const { pending, run } = useActionToast();

  return (
    <Checkbox
      checked={granted}
      disabled={disabled || pending}
      aria-label={`${permissionCode} untuk ${roleName}`}
      onCheckedChange={(checked) =>
        run(() =>
          setRolePermissionAction({ roleId, permissionCode, granted: checked === true }),
        )
      }
    />
  );
}
