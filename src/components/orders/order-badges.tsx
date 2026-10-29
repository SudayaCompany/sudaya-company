import { Badge } from "@/components/ui/badge";
import {
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders/state";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Partial<Record<OrderStatus, string>> = {
  pending_payment: "bg-brand/15 text-foreground",
  queued: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  preparing: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ready: "bg-success/15 text-success",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  refunded: "bg-destructive/10 text-destructive",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge variant="secondary" className={cn(STATUS_STYLE[status])}>
      {ORDER_STATUS_LABELS[status]}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge
      variant={status === "paid" ? "secondary" : "outline"}
      className={cn(status === "paid" && "bg-success/15 text-success")}
    >
      {PAYMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
