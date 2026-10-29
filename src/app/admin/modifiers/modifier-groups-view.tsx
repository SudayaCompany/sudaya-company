"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatPriceDelta } from "@/lib/format";

import { ModifierGroupEditor, type ModifierGroupDraft } from "./modifier-group-editor";
import { MODIFIER_PRESETS } from "./presets";

export type ModifierGroupView = ModifierGroupDraft & { id: string; productCount: number };

const EMPTY: ModifierGroupDraft = {
  name: "",
  selection: "single",
  isRequired: false,
  minSelect: 0,
  maxSelect: 1,
  sortOrder: 0,
  options: [{ name: "", priceDelta: 0, isDefault: false, isActive: true }],
};

function rule(group: ModifierGroupDraft) {
  const required = group.isRequired || group.minSelect > 0;
  if (group.selection === "single") return required ? "Wajib pilih 1" : "Opsional, pilih 1";
  const max = group.maxSelect ? `maks ${group.maxSelect}` : "tanpa batas";
  return required ? `Wajib, min ${group.minSelect}, ${max}` : `Opsional, ${max}`;
}

export function ModifierGroupsView({
  brandId,
  groups,
  canCreate,
  canEdit,
  canDelete,
}: {
  brandId: string;
  groups: ModifierGroupView[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [creating, setCreating] = useState<{ key: number; draft: ModifierGroupDraft } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {canCreate ? (
        creating ? (
          <Card>
            <CardHeader>
              <CardTitle>Grup modifier baru</CardTitle>
              <CardDescription>Selisih harga ditambahkan ke harga produk saat dipilih.</CardDescription>
            </CardHeader>
            <CardContent>
              <ModifierGroupEditor
                key={creating.key}
                brandId={brandId}
                initial={creating.draft}
                onDone={() => setCreating(null)}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => setCreating({ key: Date.now(), draft: { ...EMPTY, sortOrder: groups.length } })}>
              <PlusIcon /> Grup baru
            </Button>
            <NativeSelect
              aria-label="Mulai dari template"
              value=""
              onChange={(e) => {
                const preset = MODIFIER_PRESETS[e.target.value];
                if (preset) setCreating({ key: Date.now(), draft: preset });
              }}
            >
              <NativeSelectOption value="">Mulai dari template…</NativeSelectOption>
              <NativeSelectOption value="size">Size</NativeSelectOption>
              <NativeSelectOption value="temperature">Hot/Ice</NativeSelectOption>
              <NativeSelectOption value="sugar">Sugar Level</NativeSelectOption>
              <NativeSelectOption value="shot">Extra Shot</NativeSelectOption>
              <NativeSelectOption value="milk">Milk Options</NativeSelectOption>
              <NativeSelectOption value="topping">Topping</NativeSelectOption>
            </NativeSelect>
          </div>
        )
      ) : null}

      {groups.map((group) => (
        <Card key={group.id}>
          <CardHeader>
            <CardTitle>{group.name}</CardTitle>
            <CardDescription>
              {rule(group)} · dipakai {group.productCount} produk
            </CardDescription>
            {canEdit && editing !== group.id ? (
              <CardAction>
                <Button variant="outline" size="sm" onClick={() => setEditing(group.id)}>
                  <PencilIcon /> Edit
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            {editing === group.id ? (
              <ModifierGroupEditor
                brandId={brandId}
                groupId={group.id}
                initial={group}
                productCount={group.productCount}
                canDelete={canDelete}
                onDone={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {group.options.map((option) => (
                  <Badge key={option.id} variant={option.isActive ? "secondary" : "outline"}>
                    {option.name}
                    {option.priceDelta ? ` ${formatPriceDelta(option.priceDelta)}` : ""}
                    {option.isDefault ? " · default" : ""}
                    {option.isActive ? "" : " · nonaktif"}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
