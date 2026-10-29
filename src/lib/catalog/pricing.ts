// Perhitungan harga & validasi pilihan modifier. Modul murni: dipakai di
// browser untuk tampilan, dan di server sebagai sumber harga yang sah —
// harga dari browser tidak pernah dipercaya.

/** Batas jumlah per baris keranjang. */
export const MAX_LINE_QUANTITY = 50;

export type PricingModifier = { id: string; name: string; priceDelta: number };

export type PricingGroup = {
  id: string;
  name: string;
  selection: "single" | "multiple";
  isRequired: boolean;
  minSelect: number;
  maxSelect: number | null;
  /** Hanya modifier aktif. */
  modifiers: PricingModifier[];
};

export type PricingProduct = {
  id: string;
  name: string;
  /** Harga efektif outlet (override atau harga dasar). */
  price: number;
  /** Ketersediaan efektif: tidak sold out manual DAN stok produk jadi (jika terhubung) ada. */
  isAvailable: boolean;
  /**
   * Maks. unit yang bisa dipesan (stok produk jadi). Hanya diisi untuk
   * hitungan server (quote/checkout), tidak ikut katalog publik.
   */
  stockLimit?: number | null;
  groups: PricingGroup[];
};

export type SelectedModifier = {
  groupId: string;
  groupName: string;
  modifierId: string;
  name: string;
  priceDelta: number;
};

export type PricedSelection =
  | { ok: true; unitPrice: number; modifiers: SelectedModifier[] }
  | { ok: false; error: string };

/** Batas pilihan efektif sebuah grup. */
export function selectionLimits(group: PricingGroup) {
  const optionCount = group.modifiers.length;
  const max =
    group.selection === "single"
      ? 1
      : Math.min(group.maxSelect ?? optionCount, optionCount);
  const min = Math.min(Math.max(group.minSelect, group.isRequired ? 1 : 0), max);
  return { min, max };
}

export function priceSelection(
  product: PricingProduct,
  selectedModifierIds: readonly string[],
): PricedSelection {
  if (!product.isAvailable) {
    return { ok: false, error: "Maaf, produk ini baru saja tidak tersedia." };
  }

  const selected = new Set(selectedModifierIds);
  const modifiers: SelectedModifier[] = [];
  let matched = 0;

  for (const group of product.groups) {
    const picked = group.modifiers.filter((m) => selected.has(m.id));
    matched += picked.length;
    const { min, max } = selectionLimits(group);
    if (picked.length < min) {
      return {
        ok: false,
        error: min === 1 ? `Pilih ${group.name}.` : `Pilih minimal ${min} ${group.name}.`,
      };
    }
    if (picked.length > max) {
      return { ok: false, error: `Maksimal ${max} pilihan untuk ${group.name}.` };
    }
    for (const m of picked) {
      modifiers.push({
        groupId: group.id,
        groupName: group.name,
        modifierId: m.id,
        name: m.name,
        priceDelta: m.priceDelta,
      });
    }
  }

  // Id yang bukan milik produk ini (mis. dimanipulasi) → tolak.
  if (matched !== selected.size) {
    return { ok: false, error: "Pilihan tidak valid untuk produk ini." };
  }

  const unitPrice = modifiers.reduce((sum, m) => sum + m.priceDelta, product.price);
  return { ok: true, unitPrice: Math.max(unitPrice, 0), modifiers };
}

/** Pilihan awal: modifier default, atau opsi pertama untuk grup single wajib. */
export function defaultSelection(
  product: PricingProduct,
  defaults: ReadonlySet<string> = new Set(),
) {
  const ids: string[] = [];
  for (const group of product.groups) {
    const { min, max } = selectionLimits(group);
    const picked = group.modifiers.filter((m) => defaults.has(m.id)).slice(0, max);
    if (picked.length === 0 && min > 0 && group.selection === "single") {
      picked.push(...group.modifiers.slice(0, 1));
    }
    ids.push(...picked.map((m) => m.id));
  }
  return ids;
}
