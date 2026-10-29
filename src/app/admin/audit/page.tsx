import { ScrollTextIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
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
import { listAuditLogs } from "@/lib/auth/admin-ops";
import { requirePermission } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Audit Log" };

const timeFormat = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Jakarta",
});

function summarize(value: unknown) {
  if (!value || typeof value !== "object") return null;
  return Object.entries(value as Record<string, unknown>)
    .map(([key, v]) => `${key}: ${v === null ? "—" : String(v)}`)
    .join(", ");
}

export default function AuditPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AuditLogs />
    </Suspense>
  );
}

async function AuditLogs() {
  const actor = await requirePermission("audit.view");
  const logs = await listAuditLogs(db, actor, 100);

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="100 aktivitas terakhir. Log bersifat append-only dan tidak menyimpan password atau token."
      />
      {logs.length === 0 ? (
        <EmptyState
          icon={ScrollTextIcon}
          title="Belum ada aktivitas"
          description="Aktivitas login, perubahan role, dan status akun akan muncul di sini."
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu (WIB)</TableHead>
                  <TableHead>Pelaku</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id} className="align-top">
                    <TableCell className="whitespace-nowrap text-xs">
                      {timeFormat.format(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">{log.actorName ?? "Sistem"}</TableCell>
                    <TableCell className="font-mono text-xs">{log.action}</TableCell>
                    <TableCell className="max-w-md text-xs text-muted-foreground">
                      {[
                        summarize(log.before) && `sebelum { ${summarize(log.before)} }`,
                        summarize(log.after) && `sesudah { ${summarize(log.after)} }`,
                        log.reason,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
