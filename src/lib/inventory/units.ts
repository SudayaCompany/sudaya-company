// Satuan & kuantitas stok. Modul murni (aman di browser & server).
//
// Semua hitungan memakai BigInt dalam "milli-unit" (skala 3, sama dengan
// kolom numeric(14,3)) — tidak pernah float — sehingga 0,1 + 0,2 tetap 0,3.
// Konversi hanya di antara satuan berdimensi sama (g↔kg, ml↔l) dan hanya
// jika hasilnya tepat; satuan hitung (pcs, botol, ...) tidak bisa dikonversi.

export const QTY_SCALE = 3;
const QTY_FACTOR = 10n ** BigInt(QTY_SCALE);
export const COST_SCALE = 4;

type UnitDef = { label: string; dimension: string; factor: bigint; integer?: boolean };

export const UNITS = {
  g: { label: "gram (g)", dimension: "mass", factor: 1n },
  kg: { label: "kilogram (kg)", dimension: "mass", factor: 1000n },
  ml: { label: "mililiter (ml)", dimension: "volume", factor: 1n },
  l: { label: "liter (l)", dimension: "volume", factor: 1000n },
  pcs: { label: "pcs", dimension: "pcs", factor: 1n, integer: true },
  botol: { label: "botol", dimension: "botol", factor: 1n, integer: true },
  cup: { label: "cup", dimension: "cup", factor: 1n, integer: true },
  pack: { label: "pack", dimension: "pack", factor: 1n, integer: true },
  sachet: { label: "sachet", dimension: "sachet", factor: 1n, integer: true },
  box: { label: "box", dimension: "box", factor: 1n, integer: true },
  lembar: { label: "lembar", dimension: "lembar", factor: 1n, integer: true },
} as const satisfies Record<string, UnitDef>;

export type UnitCode = keyof typeof UNITS;
export const UNIT_CODES = Object.keys(UNITS) as UnitCode[];

export const isUnitCode = (value: unknown): value is UnitCode =>
  typeof value === "string" && Object.hasOwn(UNITS, value);

const def = (unit: UnitCode): UnitDef => UNITS[unit];

/** Satuan input yang boleh dipakai untuk item bersatuan dasar `base`. */
export function compatibleUnits(base: UnitCode): UnitCode[] {
  return UNIT_CODES.filter((u) => def(u).dimension === def(base).dimension);
}

/** Satuan hitung (bilangan bulat) — dipakai untuk produk jadi yang dijual per unit. */
export const isCountUnit = (unit: UnitCode) => Boolean(def(unit).integer);

// --- Desimal eksak -------------------------------------------------------------

const DECIMAL = /^(-)?(\d{1,15})(?:[.,](\d{1,9}))?$/;

/** "1,5" / "1.5" → { units: 15n, scale: 1 }. null jika bukan angka desimal sederhana. */
function parseDecimal(input: string) {
  const match = DECIMAL.exec(input.trim());
  if (!match) return null;
  const [, minus, whole, fraction = ""] = match;
  const units = BigInt(whole + fraction) * (minus ? -1n : 1n);
  return { units, scale: fraction.length };
}

/** String desimal → milli-unit; null jika lebih dari 3 desimal / tidak valid. */
export function parseQty(input: string | number | null | undefined): bigint | null {
  if (input === null || input === undefined) return null;
  const parsed = parseDecimal(String(input));
  if (!parsed || parsed.scale > QTY_SCALE) return null;
  return parsed.units * 10n ** BigInt(QTY_SCALE - parsed.scale);
}

/** Nilai numeric dari database ("12.500") → milli-unit. */
export function qtyFromDb(value: string | null | undefined): bigint {
  return parseQty(value ?? "0") ?? 0n;
}

/** milli-unit → string untuk database / input form ("1.5", "-2", "0.125"). */
export function qtyToString(milli: bigint): string {
  const negative = milli < 0n;
  const abs = negative ? -milli : milli;
  const whole = abs / QTY_FACTOR;
  const fraction = (abs % QTY_FACTOR).toString().padStart(QTY_SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export type Converted = { ok: true; milli: bigint } | { ok: false; error: string };

/**
 * Konversi jumlah yang diinput user (dalam `from`) ke satuan dasar item
 * (`to`). Ditolak bila beda dimensi atau hasilnya tidak tepat di skala 3.
 */
export function convertQty(input: string, from: UnitCode, to: UnitCode): Converted {
  const source = def(from);
  const target = def(to);
  if (source.dimension !== target.dimension) {
    return { ok: false, error: `Satuan ${from} tidak bisa dikonversi ke ${to}.` };
  }
  const parsed = parseDecimal(input);
  if (!parsed) return { ok: false, error: "Jumlah harus berupa angka." };
  // nilai = units / 10^scale (dalam `from`) → milli `to` = nilai × fFrom / fTo × 1000
  const numerator = parsed.units * source.factor * QTY_FACTOR;
  const denominator = 10n ** BigInt(parsed.scale) * target.factor;
  if (numerator % denominator !== 0n) {
    return { ok: false, error: `Jumlah terlalu kecil/presisi untuk satuan ${to}.` };
  }
  const milli = numerator / denominator;
  if (target.integer && milli % QTY_FACTOR !== 0n) {
    return { ok: false, error: `Jumlah ${to} harus bilangan bulat.` };
  }
  return { ok: true, milli };
}

/**
 * Harga per satuan input → harga per satuan dasar (string numeric skala 4).
 * Rp 18.500 per l → "18.5" per ml. null jika input kosong; error jika tidak tepat.
 */
export function convertUnitCost(
  input: string,
  from: UnitCode,
  to: UnitCode,
): { ok: true; value: string } | { ok: false; error: string } {
  const source = def(from);
  const target = def(to);
  if (source.dimension !== target.dimension) {
    return { ok: false, error: `Satuan ${from} tidak bisa dikonversi ke ${to}.` };
  }
  const parsed = parseDecimal(input);
  if (!parsed || parsed.units < 0n) return { ok: false, error: "Harga harus angka ≥ 0." };
  const costFactor = 10n ** BigInt(COST_SCALE);
  // harga per `to` = harga per `from` × fTo / fFrom
  const numerator = parsed.units * target.factor * costFactor;
  const denominator = 10n ** BigInt(parsed.scale) * source.factor;
  if (numerator % denominator !== 0n) {
    return { ok: false, error: "Harga per satuan terlalu presisi; gunakan maksimal 4 desimal." };
  }
  const scaled = numerator / denominator;
  const whole = scaled / costFactor;
  const fraction = (scaled % costFactor).toString().padStart(COST_SCALE, "0").replace(/0+$/, "");
  return { ok: true, value: `${whole}${fraction ? `.${fraction}` : ""}` };
}

// --- Tampilan -------------------------------------------------------------------

const qtyFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: QTY_SCALE });

/** "1500.000" + "g" → "1.500 g"; "1.5" + "kg" → "1,5 kg". */
export function formatQty(value: string | bigint, unit?: string) {
  const milli = typeof value === "bigint" ? value : qtyFromDb(value);
  // Number aman untuk tampilan (presisi 15 digit > skala kolom).
  const text = qtyFormat.format(Number(qtyToString(milli)));
  return unit ? `${text} ${unit}` : text;
}

const costFormat = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  minimumFractionDigits: 0,
  maximumFractionDigits: COST_SCALE,
});

/** Harga pokok per satuan, tanpa pembulatan ke rupiah: "18.5" + "ml" → "Rp 18,5/ml". */
export function formatUnitCost(value: string, unit: string) {
  return `${costFormat.format(Number(value)).replace(/\u00a0/g, " ")}/${unit}`;
}

/** Perubahan bertanda untuk ledger: "+1.000 g" / "−250 g". */
export function formatSignedQty(value: string | bigint, unit?: string) {
  const milli = typeof value === "bigint" ? value : qtyFromDb(value);
  const sign = milli > 0n ? "+" : milli < 0n ? "−" : "";
  return `${sign}${formatQty(milli < 0n ? -milli : milli, unit)}`;
}

export type StockLevel = "out" | "low" | "ok";

/** PRD §20 & §25: habis (= 0), menipis (≤ minimum), aman. */
export function stockLevel(stock: string | bigint, minimum: string | bigint): StockLevel {
  const s = typeof stock === "bigint" ? stock : qtyFromDb(stock);
  const m = typeof minimum === "bigint" ? minimum : qtyFromDb(minimum);
  if (s <= 0n) return "out";
  if (s <= m) return "low";
  return "ok";
}
