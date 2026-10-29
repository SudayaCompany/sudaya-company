import { Badge } from "@/components/ui/badge";
import { OPNAME_STATUS_LABELS } from "@/lib/inventory/labels";

export function OpnameStatusBadge({ status }: { status: keyof typeof OPNAME_STATUS_LABELS }) {
  const variant = status === "applied" ? "secondary" : status === "rejected" ? "destructive" : "outline";
  return <Badge variant={variant}>{OPNAME_STATUS_LABELS[status]}</Badge>;
}
