"use client";

import { ChefHatIcon, CheckCheckIcon, InboxIcon, Loader2Icon, PlayIcon, Undo2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useActionToast } from "@/hooks/use-action-toast";
import { useNow } from "@/hooks/use-now";
import { updateOrderStatusAction } from "@/lib/orders/actions";
import type { KdsOrder } from "@/lib/orders/engine";
import { ORDER_TYPE_LABELS, nextProductionStatus, type OrderStatus } from "@/lib/orders/state";
import { cn } from "@/lib/utils";

const COLUMNS: { status: OrderStatus; title: string; accent: string }[] = [
  { status: "queued", title: "New", accent: "border-t-sky-500" },
  { status: "preparing", title: "Preparing", accent: "border-t-amber-500" },
  { status: "ready", title: "Ready", accent: "border-t-success" },
  { status: "completed", title: "Completed", accent: "border-t-neutral-400" },
];

const ACTION: Partial<Record<OrderStatus, { label: string; icon: React.ReactNode }>> = {
  queued: { label: "Start Preparing", icon: <PlayIcon /> },
  preparing: { label: "Mark Ready", icon: <ChefHatIcon /> },
  ready: { label: "Complete", icon: <CheckCheckIcon /> },
};

const BACK: Partial<Record<OrderStatus, OrderStatus>> = { preparing: "queued", ready: "preparing" };

function elapsed(fromIso: Date | string | null, now: number) {
  if (!fromIso || now === 0) return { text: "--:--", minutes: 0 };
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return { text: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, minutes: m };
}

export function KdsBoard({
  orders,
  canUpdate,
  canOverride,
}: {
  orders: KdsOrder[];
  canUpdate: boolean;
  canOverride: boolean;
}) {
  const now = useNow();

  return (
    <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((column) => {
        const items = orders.filter((o) => o.status === column.status);
        return (
          <section key={column.status} className={cn("flex min-h-64 flex-col gap-3 rounded-xl border border-t-4 bg-muted/40 p-3", column.accent)}>
            <h2 className="flex items-center justify-between text-lg font-bold tracking-wide uppercase">
              {column.title}
              <span className="rounded-full bg-background px-2.5 py-0.5 text-sm tabular-nums">{items.length}</span>
            </h2>
            {items.length === 0 ? (
              <p className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <InboxIcon className="size-6" aria-hidden />
                Kosong
              </p>
            ) : (
              items.map((order) => (
                <OrderCard key={order.id} order={order} now={now} canUpdate={canUpdate} canOverride={canOverride} />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function OrderCard({
  order,
  now,
  canUpdate,
  canOverride,
}: {
  order: KdsOrder;
  now: number;
  canUpdate: boolean;
  canOverride: boolean;
}) {
  const { pending, run } = useActionToast();
  const done = order.status === "completed";
  const wait = elapsed(order.paidAt, done ? new Date(order.completedAt ?? order.paidAt!).getTime() : now);
  const action = ACTION[order.status];
  const next = nextProductionStatus(order.status);
  const back = BACK[order.status];
  const move = (to: OrderStatus) =>
    run(() => updateOrderStatusAction({ orderId: order.id, from: order.status, to }));

  return (
    <article
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-background p-3 shadow-sm",
        !done && wait.minutes >= 10 && "border-destructive ring-2 ring-destructive/30",
        !done && wait.minutes >= 5 && wait.minutes < 10 && "border-amber-500",
        done && "opacity-70",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-2xl font-black">{order.orderNumber}</p>
          <p className="text-sm font-medium">
            {order.customerName ?? "Walk-in"} — {ORDER_TYPE_LABELS[order.type]}
            {order.tableNumber ? ` · Meja ${order.tableNumber}` : ""}
          </p>
        </div>
        <span
          className={cn(
            "rounded-lg px-2 py-1 font-mono text-lg font-bold tabular-nums",
            done ? "bg-muted" : wait.minutes >= 10 ? "bg-destructive text-white" : wait.minutes >= 5 ? "bg-amber-500 text-white" : "bg-muted",
          )}
          aria-label={`Menunggu ${wait.text}`}
        >
          {wait.text}
        </span>
      </header>

      <ul className="flex flex-col gap-1.5 border-t pt-2">
        {order.lines.map((line) => (
          <li key={line.id}>
            <p className="text-base font-semibold">
              {line.productName} × {line.quantity}
            </p>
            {line.modifiers.map((m) => (
              <p key={`${line.id}-${m.groupName}-${m.name}`} className="pl-3 text-sm text-muted-foreground">
                – {m.name}
              </p>
            ))}
            {line.notes ? <p className="pl-3 text-sm font-medium text-brand">“{line.notes}”</p> : null}
          </li>
        ))}
      </ul>
      {order.notes ? (
        <p className="rounded-lg bg-brand/10 px-2 py-1.5 text-sm">
          <span className="font-semibold">Catatan:</span> {order.notes}
        </p>
      ) : null}

      {canUpdate && action && next ? (
        <div className="flex gap-2">
          {canOverride && back ? (
            <Button variant="outline" size="lg" className="h-12" disabled={pending} onClick={() => move(back)} aria-label="Kembalikan status">
              <Undo2Icon />
            </Button>
          ) : null}
          <Button
            size="lg"
            className={cn(
              "h-12 flex-1 text-base",
              order.status === "preparing" && "bg-success text-success-foreground hover:bg-success/90",
            )}
            disabled={pending}
            onClick={() => move(next)}
          >
            {pending ? <Loader2Icon className="animate-spin" /> : action.icon}
            {action.label}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
