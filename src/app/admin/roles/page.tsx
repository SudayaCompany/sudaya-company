import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { listCompanyRoles, listPermissions } from "@/lib/auth/admin-ops";
import { permissionSet } from "@/lib/auth/policy";
import { SUPER_ADMIN_ROLE } from "@/lib/auth/rbac";
import { requirePermission } from "@/lib/auth/session";

import { PermissionToggle } from "./permission-toggle";

export const metadata: Metadata = { title: "Role & Permission" };

export default function RolesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RoleMatrix />
    </Suspense>
  );
}

async function RoleMatrix() {
  const actor = await requirePermission("role.manage");
  const [roles, permissions] = await Promise.all([
    listCompanyRoles(db, actor),
    listPermissions(db),
  ]);

  // Aturan yang sama dengan server (admin-ops) — di sini hanya untuk
  // menonaktifkan checkbox; server tetap memvalidasi ulang.
  const actorPermissions = permissionSet(actor, { outletId: null });
  const actorRoleIds = new Set(actor.grants.map((g) => g.roleId));

  const groups = new Map<string, typeof permissions>();
  for (const permission of permissions) {
    const group = permission.code.split(".")[0];
    groups.set(group, [...(groups.get(group) ?? []), permission]);
  }

  return (
    <>
      <PageHeader
        title="Role & Permission"
        description="Super Admin selalu memiliki semua permission. Role yang Anda pegang sendiri tidak bisa diubah dari akun Anda."
      />
      <Card>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-56">Permission</TableHead>
                {roles.map((role) => (
                  <TableHead key={role.id} className="text-center">
                    {role.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...groups.entries()].map(([group, items]) => (
                <GroupRows key={group} group={group}>
                  {items.map((permission) => (
                    <TableRow key={permission.code}>
                      <TableCell>
                        <p className="font-mono text-xs">{permission.code}</p>
                        <p className="text-xs text-muted-foreground">
                          {permission.description}
                        </p>
                      </TableCell>
                      {roles.map((role) => (
                        <TableCell key={role.id} className="text-center">
                          <PermissionToggle
                            roleId={role.id}
                            roleName={role.name}
                            permissionCode={permission.code}
                            granted={role.permissions.includes(permission.code)}
                            disabled={
                              role.code === SUPER_ADMIN_ROLE ||
                              actorRoleIds.has(role.id) ||
                              !actorPermissions.has(permission.code)
                            }
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </GroupRows>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

function GroupRows({ group, children }: { group: string; children: React.ReactNode }) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell colSpan={99} className="text-xs font-semibold tracking-wide uppercase">
          {group}
        </TableCell>
      </TableRow>
      {children}
    </>
  );
}
