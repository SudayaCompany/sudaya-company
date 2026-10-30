import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/page-header";
import { db } from "@/db";
import { employeeFormOptions, getEmployee } from "@/lib/attendance/employees";
import { AccessError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/session";

import { EmployeeForm } from "../../employee-form";

export const metadata: Metadata = { title: "Ubah karyawan" };

export default function EditEmployeePage({ params }: PageProps<"/admin/employees/[id]/edit">) {
  return (
    <>
      <PageHeader title="Ubah karyawan" />
      <Suspense fallback={<PageSkeleton />}>
        <EditEmployee params={params} />
      </Suspense>
    </>
  );
}

async function EditEmployee({ params }: Pick<PageProps<"/admin/employees/[id]/edit">, "params">) {
  const actor = await requirePermission("employee.edit");
  const { id } = await params;
  const detail = await getEmployee(db, actor, id).catch((error: unknown) => {
    if (error instanceof AccessError) notFound();
    throw error;
  });
  if (!detail.canEdit) notFound();
  const e = detail.employee;
  const options = await employeeFormOptions(db, actor, "employee.edit", e.userId);
  return (
    <EmployeeForm
      outlets={options.outlets}
      accounts={options.accounts}
      employee={{
        id: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        phone: e.phone,
        position: e.position,
        outletId: e.outletId,
        joinedAt: e.joinedAt,
        userId: e.userId,
        isActive: e.isActive,
      }}
    />
  );
}
