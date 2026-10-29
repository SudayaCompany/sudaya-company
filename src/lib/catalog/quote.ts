// Kalkulasi keranjang di server. Browser hanya mengirim id produk, id
// modifier, dan jumlah — harga apa pun yang dikirim browser dibuang oleh
// skema (z.object membuang key yang tidak dikenal) dan dihitung ulang dari DB.

import { z } from "zod";

import { MAX_LINE_QUANTITY, priceSelection } from "./pricing";
import type { Storefront } from "./storefront";

export { MAX_LINE_QUANTITY };

export const cartLineInput = z.object({
  productId: z.uuid(),
  modifierIds: z.array(z.uuid()).max(30),
  quantity: z.int().min(1).max(MAX_LINE_QUANTITY),
});
export type CartLineInput = z.infer<typeof cartLineInput>;

export const cartQuoteInput = z.object({
  outlet: z.string().trim().min(1).max(32),
  lines: z.array(cartLineInput).max(50),
});

export type CartQuoteLine = CartLineInput &
  (
    | {
        ok: true;
        name: string;
        /** Harga produk per unit sebelum modifier. */
        basePrice: number;
        modifiers: { modifierId: string; groupName: string; name: string; priceDelta: number }[];
        /** Harga per unit termasuk modifier. */
        unitPrice: number;
        lineTotal: number;
      }
    | { ok: false; name: string | null; error: string }
  );

export type CartQuote =
  | { ok: true; lines: CartQuoteLine[]; total: number; itemCount: number }
  | { ok: false; error: string };

export function quoteCart(storefront: Storefront, lines: CartLineInput[]): CartQuote {
  const products = new Map(storefront.products.map((p) => [p.id, p]));
  // Produk jadi: total semua baris produk yang sama tidak boleh melebihi stok.
  const demand = new Map<string, number>();
  for (const line of lines) demand.set(line.productId, (demand.get(line.productId) ?? 0) + line.quantity);

  const quoted: CartQuoteLine[] = lines.map((line) => {
    const product = products.get(line.productId);
    if (!product) {
      return { ...line, ok: false, name: null, error: "Produk tidak lagi tersedia di menu." };
    }
    const priced = priceSelection(product, line.modifierIds);
    if (!priced.ok) return { ...line, ok: false, name: product.name, error: priced.error };
    const limit = product.stockLimit;
    if (limit !== undefined && limit !== null && (demand.get(product.id) ?? 0) > limit) {
      return { ...line, ok: false, name: product.name, error: `Stok tersisa ${limit}. Kurangi jumlahnya.` };
    }
    return {
      ...line,
      ok: true,
      name: product.name,
      basePrice: product.price,
      modifiers: priced.modifiers.map((m) => ({
        modifierId: m.modifierId,
        groupName: m.groupName,
        name: m.name,
        priceDelta: m.priceDelta,
      })),
      unitPrice: priced.unitPrice,
      lineTotal: priced.unitPrice * line.quantity,
    };
  });

  return {
    ok: true,
    lines: quoted,
    total: quoted.reduce((sum, l) => sum + (l.ok ? l.lineTotal : 0), 0),
    itemCount: quoted.reduce((sum, l) => sum + (l.ok ? l.quantity : 0), 0),
  };
}
