import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader, PageSkeleton } from "@/components/page-header";
import { db } from "@/db";
import { employeeFormOptions } from "@/lib/attendance/employees";
import { requirePermission } from "@/lib/auth/session";

import { EmployeeForm } from "../employee-form";

export const metadata: Metadata = { title: "Karyawan baru" };

export default function NewEmployeePage() {
  return (
    <>
      <PageHeader title="Karyawan baru" description="Data karyawan untuk absensi. Akun login ditautkan dari menu Pengguna." />
      <Suspense fallback={<PageSkeleton />}>
        <NewEmployee />
      </Suspense>
    </>
  );
}

async function NewEmployee() {
  const actor = await requirePermission("employee.create");
  const options = await employeeFormOptions(db, actor, "employee.create");
  return <EmployeeForm outlets={options.outlets} accounts={options.accounts} />;
}
