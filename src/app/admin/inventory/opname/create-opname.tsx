"use client";

import { ClipboardListIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useActionToast } from "@/hooks/use-action-toast";
import { createOpnameAction } from "@/lib/inventory/actions";

/** Buat sesi opname → saldo sistem semua item aktif di-snapshot saat itu. */
export function CreateOpname({ outletId, categories }: { outletId: string; categories: string[] }) {
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const { pending, run } = useActionToast();
  const router = useRouter();

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => createOpnameAction({ outletId, category: category || undefined, notes: notes || undefined }),
          (result) => {
            if (result.data) router.push(`/admin/inventory/opname/${result.data.id}`);
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opname-category">Cakupan</Label>
          <NativeSelect id="opname-category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full">
            <NativeSelectOption value="">Semua item aktif</NativeSelectOption>
            {categories.map((c) => (
              <NativeSelectOption key={c} value={c}>Kategori: {c}</NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opname-notes">Catatan</Label>
          <Input id="opname-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="mis. opname akhir bulan" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Saldo sistem dicatat (snapshot) saat sesi dibuat. Hitung fisik segera setelahnya; mutasi setelah
        snapshot (mis. penjualan) tetap diperhitungkan karena yang diposting adalah selisihnya.
      </p>
      <Button type="submit" disabled={pending} className="h-11 sm:w-fit">
        {pending ? <Loader2Icon className="animate-spin" /> : <ClipboardListIcon />} Mulai opname
      </Button>
    </form>
  );
}
