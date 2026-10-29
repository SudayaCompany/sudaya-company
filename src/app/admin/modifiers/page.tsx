import { SlidersHorizontalIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageSkeleton } from "@/components/page-header";
import { db } from "@/db";
import { hasPermission } from "@/lib/auth/policy";
import { requirePermission } from "@/lib/auth/session";
import { listModifierGroups, resolveCatalogScope } from "@/lib/catalog/admin-ops";

import { ModifierGroupsView } from "./modifier-groups-view";

export const metadata: Metadata = { title: "Modifier" };

export default function ModifiersPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Modifiers />
    </Suspense>
  );
}

async function Modifiers() {
  const actor = await requirePermission("product.view");
  const scope = await resolveCatalogScope(db, actor);
  const groups = await listModifierGroups(db, actor, scope.brand.id);
  const canCreate = hasPermission(actor, "product.create", { outletId: null });

  return (
    <>
      <PageHeader
        title="Modifier"
        description={`${scope.brand.name} · Variant & add-on: size, suhu, gula, extra shot, susu, topping.`}
      />
      {groups.length === 0 && !canCreate ? (
        <EmptyState
          icon={SlidersHorizontalIcon}
          title="Belum ada grup modifier"
          description="Grup modifier dibuat oleh admin menu."
        />
      ) : (
        <ModifierGroupsView
          brandId={scope.brand.id}
          groups={groups}
          canCreate={canCreate}
          canEdit={hasPermission(actor, "product.edit", { outletId: null })}
          canDelete={hasPermission(actor, "product.delete", { outletId: null })}
        />
      )}
    </>
  );
}
