import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import {
  listCompanyOutlets,
  listCompanyRoles,
  listCompanyUsers,
} from "@/lib/auth/admin-ops";
import { scopeLabel } from "@/lib/auth/format";
import { requirePermission } from "@/lib/auth/session";

import { InviteStaffForm } from "./invite-staff-form";
import { RevokeRoleButton, RoleAssigner, StatusToggle } from "./user-controls";

export const metadata: Metadata = { title: "Pengguna" };

export default function UsersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Users />
    </Suspense>
  );
}

async function Users() {
  const actor = await requirePermission("user.manage");
  const [users, roles, outlets] = await Promise.all([
    listCompanyUsers(db, actor),
    listCompanyRoles(db, actor),
    listCompanyOutlets(db, actor),
  ]);

  const roleOptions = roles.map((r) => ({ id: r.id, label: r.name }));
  const outletOptions = outlets.map((o) => ({ id: o.id, label: o.name }));
  const outletNames = new Map(outlets.map((o) => [o.id, o.name]));

  return (
    <>
      <PageHeader
        title="Pengguna"
        description={`Akun staf ${actor.company.name}. Setiap perubahan akses tercatat di audit log.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Undang staf</CardTitle>
          <CardDescription>
            Staf membuat password sendiri lewat link undangan. Anda hanya bisa
            memberi role yang permission-nya juga Anda miliki.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteStaffForm roles={roleOptions} outlets={outletOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daftar akun</CardTitle>
          <CardDescription>{users.length} akun terdaftar</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const isSelf = user.id === actor.id;
                return (
                  <TableRow key={user.id} className="align-top">
                    <TableCell>
                      <p className="font-medium">{user.fullName}</p>
                      <p className="text-xs text-muted-foreground">{user.email ?? "—"}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          {user.grants.length === 0 ? (
                            <span className="text-xs text-muted-foreground">Belum ada role</span>
                          ) : (
                            user.grants.map((grant) => (
                              <Badge key={grant.userRoleId} variant="secondary" className="gap-1">
                                {grant.roleName} · {scopeLabel(grant.outletId, outletNames)}
                                {isSelf ? null : (
                                  <RevokeRoleButton
                                    userRoleId={grant.userRoleId}
                                    label={grant.roleName}
                                  />
                                )}
                              </Badge>
                            ))
                          )}
                        </div>
                        {isSelf ? null : (
                          <RoleAssigner
                            userId={user.id}
                            roles={roleOptions}
                            outlets={outletOptions}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.isActive ? "default" : "destructive"}>
                        {user.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {isSelf ? (
                        <span className="text-xs text-muted-foreground">Akun Anda</span>
                      ) : (
                        <StatusToggle userId={user.id} isActive={user.isActive} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
