"use client";

import { Loader2Icon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useActionToast } from "@/hooks/use-action-toast";

import {
  createModifierGroupAction,
  deleteModifierGroupAction,
  updateModifierGroupAction,
} from "./actions";

export type ModifierOptionDraft = {
  id?: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  isActive: boolean;
};

export type ModifierGroupDraft = {
  name: string;
  selection: "single" | "multiple";
  isRequired: boolean;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  options: ModifierOptionDraft[];
};

let draftKey = 0;
const withKeys = (options: ModifierOptionDraft[]) =>
  options.map((o) => ({ ...o, key: o.id ?? `new-${draftKey++}` }));

export function ModifierGroupEditor({
  brandId,
  groupId,
  initial,
  productCount = 0,
  canDelete = false,
  onDone,
}: {
  brandId: string;
  groupId?: string;
  initial: ModifierGroupDraft;
  productCount?: number;
  canDelete?: boolean;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState(() => ({ ...initial, options: withKeys(initial.options) }));
  const { pending, run } = useActionToast();
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setOption = (key: string, patch: Partial<ModifierOptionDraft>) =>
    setDraft((d) => ({
      ...d,
      options: d.options.map((o) => {
        if (o.key === key) return { ...o, ...patch };
        // Grup pilihan tunggal: hanya satu default.
        if (patch.isDefault && d.selection === "single") return { ...o, isDefault: false };
        return o;
      }),
    }));

  function save() {
    const values = {
      name: draft.name,
      selection: draft.selection,
      isRequired: draft.isRequired,
      minSelect: draft.minSelect,
      maxSelect: draft.selection === "single" ? 1 : draft.maxSelect,
      sortOrder: draft.sortOrder,
      options: draft.options.map((o) => ({
        id: o.id,
        name: o.name,
        priceDelta: o.priceDelta,
        isDefault: o.isDefault,
        isActive: o.isActive,
      })),
    };
    run(
      () =>
        groupId
          ? updateModifierGroupAction({ id: groupId, values })
          : createModifierGroupAction({ id: brandId, values }),
      () => onDone?.(),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Nama grup</Label>
          <Input value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="mis. Size" />
        </div>
        <div className="grid gap-1.5">
          <Label>Jenis pilihan</Label>
          <NativeSelect
            value={draft.selection}
            className="w-full"
            onChange={(e) => {
              const selection = e.target.value as "single" | "multiple";
              setDraft((d) => ({ ...d, selection, maxSelect: selection === "single" ? 1 : d.maxSelect }));
            }}
          >
            <NativeSelectOption value="single">Pilih satu</NativeSelectOption>
            <NativeSelectOption value="multiple">Pilih beberapa</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label>Urutan tampil</Label>
          <Input
            type="number"
            min={0}
            max={9999}
            value={draft.sortOrder}
            onChange={(e) => set("sortOrder", Number(e.target.value))}
          />
        </div>
        <label className="flex items-center justify-between gap-2 self-end rounded-lg border px-3 py-1.5 text-sm">
          Wajib dipilih
          <Switch
            checked={draft.isRequired}
            onCheckedChange={(isRequired) =>
              setDraft((d) => ({ ...d, isRequired, minSelect: isRequired ? Math.max(d.minSelect, 1) : 0 }))
            }
          />
        </label>
        {draft.selection === "multiple" ? (
          <>
            <div className="grid gap-1.5">
              <Label>Minimal dipilih</Label>
              <Input
                type="number"
                min={0}
                max={20}
                value={draft.minSelect}
                onChange={(e) => set("minSelect", Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Maksimal dipilih</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={draft.maxSelect ?? ""}
                placeholder="Tanpa batas"
                onChange={(e) => set("maxSelect", e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <div className="hidden gap-2 text-xs text-muted-foreground sm:grid sm:grid-cols-[1fr_9rem_auto_auto_auto]">
          <span>Pilihan</span>
          <span>Selisih harga (Rp)</span>
          <span>Default</span>
          <span>Aktif</span>
          <span />
        </div>
        {draft.options.map((option) => (
          <div key={option.key} className="grid items-center gap-2 sm:grid-cols-[1fr_9rem_auto_auto_auto]">
            <Input
              value={option.name}
              onChange={(e) => setOption(option.key, { name: e.target.value })}
              placeholder="Nama pilihan"
              aria-label="Nama pilihan"
            />
            <Input
              type="number"
              step={500}
              value={option.priceDelta}
              onChange={(e) => setOption(option.key, { priceDelta: Number(e.target.value) })}
              aria-label="Selisih harga"
              className="tabular-nums"
            />
            <Switch
              checked={option.isDefault}
              onCheckedChange={(isDefault) => setOption(option.key, { isDefault })}
              aria-label={`Default ${option.name}`}
            />
            <Switch
              checked={option.isActive}
              onCheckedChange={(isActive) => setOption(option.key, { isActive })}
              aria-label={`Aktif ${option.name}`}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={draft.options.length <= 1}
              onClick={() => setDraft((d) => ({ ...d, options: d.options.filter((o) => o.key !== option.key) }))}
              aria-label={`Hapus pilihan ${option.name}`}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            setDraft((d) => ({
              ...d,
              options: [...d.options, ...withKeys([{ name: "", priceDelta: 0, isDefault: false, isActive: true }])],
            }))
          }
        >
          <PlusIcon /> Tambah pilihan
        </Button>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {groupId && canDelete ? (
          <ConfirmAction
            trigger={
              <Button variant="ghost" disabled={pending}>
                <Trash2Icon className="text-destructive" /> Hapus grup
              </Button>
            }
            title="Hapus grup modifier?"
            description={`${draft.name} akan dilepas dari ${productCount} produk. Histori order tetap menyimpan pilihan lama.`}
            confirmLabel="Hapus grup"
            onConfirm={() => run(() => deleteModifierGroupAction(groupId))}
          />
        ) : null}
        {onDone ? (
          <Button variant="outline" onClick={onDone} disabled={pending}>
            Batal
          </Button>
        ) : null}
        <Button onClick={save} disabled={pending}>
          {pending ? <Loader2Icon className="animate-spin" /> : null} Simpan
        </Button>
      </div>
    </div>
  );
}
