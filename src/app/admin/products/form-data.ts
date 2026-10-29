import "server-only";

import { db } from "@/db";
import type { CurrentUser } from "@/lib/auth/access";
import { listCategories, listModifierGroups } from "@/lib/catalog/admin-ops";
import { selectionLimits } from "@/lib/catalog/pricing";

/** Pilihan kategori & grup modifier untuk form produk. */
export async function productFormOptions(actor: CurrentUser, brandId: string) {
  const [categories, groups] = await Promise.all([
    listCategories(db, actor, brandId),
    listModifierGroups(db, actor, brandId),
  ]);
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.isActive ? c.name : `${c.name} (nonaktif)` })),
    modifierGroups: groups.map((g) => {
      const active = g.options.filter((o) => o.isActive);
      const { min, max } = selectionLimits({ ...g, modifiers: active });
      const rule = g.isRequired || min > 0 ? `wajib, pilih ${min === max ? min : `${min}–${max}`}` : `opsional, maks ${max}`;
      return {
        id: g.id,
        name: g.name,
        summary: `${active.length} pilihan · ${rule}`,
      };
    }),
  };
}
