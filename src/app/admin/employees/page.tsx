import { IdCardIcon, PlusIcon, SearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/db";
import { employeeListParams, listEmployees, type EmployeeRow } from "@/lib/attendance/employees";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { firstValues } from "@/lib/search-params";

export const metadata: Metadata = { title: "Karyawan" };

export default function EmployeesPage({ searchParams }: PageProps<"/admin/employees">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Employees searchParams={searchParams} />
    </Suspense>
  );
}

function FaceBadge({ row }: { row: EmployeeRow }) {
  return row.faceEnrolled ? <Badge variant="secondary">Wajah terdaftar</Badge> : <Badge variant="outline">Wajah belum terdaftar</Badge>;
}

function StatusBadge({ row }: { row: EmployeeRow }) {
  return row.isActive ? <Badge variant="secondary" className="bg-success/15 text-success">Aktif</Badge> : <Badge variant="outline">Nonaktif</Badge>;
}

async function Employees({ searchParams }: Pick<PageProps<"/admin/employees">, "searchParams">) {
  const actor = await requirePermission("employee.view");
  const raw = firstValues(await searchParams);
  const params = employeeListParams.parse(raw);
  const list = await listEmployees(db, actor, params);
  const canCreate = list.outlets.some((o) => hasPermission(actor, "employee.create", { outletId: o.id }));

  return (
    <>
      <PageHeader title="Karyawan" description={`${list.rows.length} karyawan`}>
        {canCreate ? (
          <Link href="/admin/employees/new" className={buttonVariants()}>
            <PlusIcon /> Karyawan baru
          </Link>
        ) : null}
      </PageHeader>

      <form method="get" className="grid grid-cols-2 gap-2 lg:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative col-span-2 lg:col-span-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" type="search" defaultValue={params.q} placeholder="Cari nama, Employee ID, atau email" className="pl-8" aria-label="Cari karyawan" />
        </div>
        <NativeSelect name="outlet" defaultValue={params.outlet ?? ""} aria-label="Outlet" className="w-full">
          <NativeSelectOption value="">Semua outlet</NativeSelectOption>
          {list.outlets.map((o) => (
            <NativeSelectOption key={o.id} value={o.id}>{o.name}</NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={params.status} aria-label="Status" className="w-full">
          <NativeSelectOption value="active">Aktif</NativeSelectOption>
          <NativeSelectOption value="inactive">Nonaktif</NativeSelectOption>
          <NativeSelectOption value="all">Semua status</NativeSelectOption>
        </NativeSelect>
        <Button type="submit" variant="outline" className="col-span-2 lg:col-span-1">Terapkan</Button>
      </form>

      {list.rows.length === 0 ? (
        <EmptyState icon={IdCardIcon} title="Belum ada karyawan" description="Tambahkan karyawan lalu tautkan ke akun login agar bisa absensi." />
      ) : (
        <>
          <ul className="flex flex-col gap-2 md:hidden">
            {list.rows.map((row) => (
              <li key={row.id}>
                <Link href={`/admin/employees/${row.id}`} className="flex flex-col gap-1.5 rounded-xl border p-3 hover:border-foreground">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.fullName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{row.employeeCode}</p>
                    </div>
                    <StatusBadge row={row} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[row.position, row.outletName, row.email ?? "Belum punya akun"].filter(Boolean).join(" · ")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <FaceBadge row={row} />
                    {row.roles.map((r) => (
                      <Badge key={r} variant="outline">{r}</Badge>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Card className="hidden md:block">
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Jabatan</TableHead>
                    <TableHead>Outlet</TableHead>
                    <TableHead>Akun & role</TableHead>
                    <TableHead>Wajah</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link href={`/admin/employees/${row.id}`} className="font-medium hover:underline">{row.fullName}</Link>
                        <p className="font-mono text-xs text-muted-foreground">{row.employeeCode}</p>
                      </TableCell>
                      <TableCell className="text-sm">{row.position ?? "—"}</TableCell>
                      <TableCell className="text-sm">{row.outletName}</TableCell>
                      <TableCell className="text-sm">
                        {row.email ?? <span className="text-muted-foreground">Belum punya akun</span>}
                        {row.roles.length ? <p className="text-xs text-muted-foreground">{row.roles.join(", ")}</p> : null}
                      </TableCell>
                      <TableCell><FaceBadge row={row} /></TableCell>
                      <TableCell><StatusBadge row={row} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
