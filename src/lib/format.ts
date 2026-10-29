const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** 25000 → "Rp 25.000" */
export function formatRupiah(amount: number) {
  return rupiah.format(amount).replace(/ /g, " ");
}

/** Selisih harga modifier: 5000 → "+Rp 5.000", 0 → "" */
export function formatPriceDelta(delta: number) {
  if (delta === 0) return "";
  return `${delta > 0 ? "+" : "−"}${formatRupiah(Math.abs(delta))}`;
}
