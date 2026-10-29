import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { quoteCart } from "@/lib/catalog/quote";
import { availabilityOf, type Storefront } from "@/lib/catalog/storefront";
import { isReversible } from "@/lib/inventory/ops";
import { adjustmentInput, itemCreateInput, stockOutInput } from "@/lib/inventory/schemas";
import {
  compatibleUnits,
  convertQty,
  convertUnitCost,
  formatQty,
  formatSignedQty,
  formatUnitCost,
  parseQty,
  qtyFromDb,
  qtyToString,
  stockLevel,
} from "@/lib/inventory/units";
import { CHECKOUT_LIMITS, checkoutRules, readDeviceId, newDeviceId } from "@/lib/orders/checkout-limits";
import { trustedClientIp } from "@/lib/security/client-ip";

const headers = (values: Record<string, string>) => new Headers(values);

describe("kuantitas eksak (BigInt, skala 3)", () => {
  it("parse & format tanpa float", () => {
    expect(parseQty("0.1")! + parseQty("0.2")!).toBe(parseQty("0.3"));
    expect(parseQty("1,5")).toBe(1500n);
    expect(parseQty("12")).toBe(12000n);
    expect(parseQty("0.0001")).toBeNull(); // > 3 desimal
    expect(parseQty("1e3")).toBeNull();
    expect(parseQty("abc")).toBeNull();
    expect(qtyToString(-250n)).toBe("-0.25");
    expect(qtyToString(1_500_000n)).toBe("1500");
    expect(qtyFromDb("1500.000")).toBe(1_500_000n);
  });

  it("konversi hanya antar dimensi sama dan harus tepat", () => {
    expect(convertQty("1.5", "kg", "g")).toEqual({ ok: true, milli: 1_500_000n });
    expect(convertQty("250", "g", "kg")).toEqual({ ok: true, milli: 250n }); // 0,25 kg
    expect(convertQty("0.5", "g", "kg").ok).toBe(false); // 0,0005 kg tidak tepat di skala 3
    expect(convertQty("1", "l", "g")).toMatchObject({ ok: false, error: expect.stringContaining("tidak bisa dikonversi") });
    expect(convertQty("1", "pcs", "botol").ok).toBe(false);
    expect(convertQty("1.5", "pcs", "pcs")).toMatchObject({ ok: false, error: expect.stringContaining("bilangan bulat") });
    expect(compatibleUnits("ml")).toEqual(["ml", "l"]);
    expect(compatibleUnits("botol")).toEqual(["botol"]);
  });

  it("harga per satuan input → per satuan dasar", () => {
    expect(convertUnitCost("18500", "l", "ml")).toEqual({ ok: true, value: "18.5" });
    expect(convertUnitCost("150000", "kg", "g")).toEqual({ ok: true, value: "150" });
    expect(convertUnitCost("2.5", "g", "kg")).toEqual({ ok: true, value: "2500" });
    expect(convertUnitCost("0.00001", "kg", "g").ok).toBe(false);
    expect(convertUnitCost("-1", "g", "g").ok).toBe(false);
  });

  it("level stok PRD §20/§25 & tampilan", () => {
    expect(stockLevel("0", "5")).toBe("out");
    expect(stockLevel("5", "5")).toBe("low");
    expect(stockLevel("5.001", "5")).toBe("ok");
    expect(stockLevel("3", "0")).toBe("ok");
    expect(formatQty("1500.000", "ml")).toBe("1.500 ml");
    expect(formatQty("1.5", "kg")).toBe("1,5 kg");
    expect(formatSignedQty("-250.000", "g")).toBe("−250 g");
    expect(formatSignedQty(2000n, "pcs")).toBe("+2 pcs");
    // Harga pokok per satuan tidak dibulatkan ke rupiah.
    expect(formatUnitCost("18.5000", "ml")).toBe("Rp 18,5/ml");
    expect(formatUnitCost("14000", "botol")).toBe("Rp 14.000/botol");
  });
});

describe("validasi input inventory", () => {
  it("SKU dinormalisasi & satuan hitung wajib bulat", () => {
    const base = { outletId: randomUUID(), sku: "milk-01", name: "Susu", kind: "raw_material", unit: "ml" };
    expect(itemCreateInput.parse(base).sku).toBe("MILK-01");
    expect(itemCreateInput.safeParse({ ...base, sku: "MILK 01" }).success).toBe(false);
    expect(itemCreateInput.safeParse({ ...base, unit: "ons" }).success).toBe(false);
    expect(itemCreateInput.safeParse({ ...base, unit: "pcs", openingStock: "1.5" }).success).toBe(false);
    expect(itemCreateInput.safeParse({ ...base, minimumStock: "-1" }).success).toBe(false);
  });

  it("saldo tidak pernah dikirim browser; alasan wajib untuk koreksi & 'lainnya'", () => {
    const parsed = stockOutInput.parse({
      idempotencyKey: randomUUID(),
      itemId: randomUUID(),
      reason: "spilled",
      quantity: "1",
      unit: "g",
      balance: "999",
      stockQty: "999",
    });
    expect(parsed).not.toHaveProperty("balance");
    expect(parsed).not.toHaveProperty("stockQty");
    expect(
      stockOutInput.safeParse({ idempotencyKey: randomUUID(), itemId: randomUUID(), reason: "other_waste", quantity: "1", unit: "g" }).success,
    ).toBe(false);
    expect(adjustmentInput.safeParse({ itemId: randomUUID(), direction: "in", quantity: "1", unit: "g", reason: "x" }).success).toBe(false);
  });

  it("hanya movement manual yang bisa di-reversal", () => {
    expect(isReversible("purchase")).toBe(true);
    expect(isReversible("waste")).toBe(true);
    expect(isReversible("sale")).toBe(false);
    expect(isReversible("opname")).toBe(false);
    expect(isReversible("reversal")).toBe(false);
  });
});

describe("ketersediaan menu (manual vs stok)", () => {
  it("manual sold out, inventory unavailable, dan efektif dipisah", () => {
    const none = { linkedItemId: null, linkedStock: null, linkedActive: null };
    expect(availabilityOf({ manualAvailable: true, ...none })).toEqual({ manualSoldOut: false, inventoryUnavailable: false, effective: true });
    expect(availabilityOf({ manualAvailable: false, ...none }).effective).toBe(false);
    const linked = { linkedItemId: randomUUID(), linkedActive: true };
    expect(availabilityOf({ manualAvailable: true, ...linked, linkedStock: "0.000" })).toEqual({ manualSoldOut: false, inventoryUnavailable: true, effective: false });
    expect(availabilityOf({ manualAvailable: false, ...linked, linkedStock: "10.000" })).toEqual({ manualSoldOut: true, inventoryUnavailable: false, effective: false });
    expect(availabilityOf({ manualAvailable: true, linkedItemId: randomUUID(), linkedActive: false, linkedStock: "5" }).inventoryUnavailable).toBe(true);
  });

  it("quote menolak jumlah melebihi stok produk jadi (total semua baris)", () => {
    const productId = randomUUID();
    const storefront: Storefront = {
      outlet: { id: randomUUID(), code: "X", name: "X" },
      brand: { id: randomUUID(), name: "B" },
      categories: [],
      products: [
        { id: productId, name: "Bottle", slug: "bottle", description: null, imageUrl: null, categoryId: randomUUID(), defaultModifierIds: [], price: 30000, isAvailable: true, stockLimit: 3, groups: [] },
      ],
    };
    const line = (quantity: number) => ({ productId, modifierIds: [], quantity });
    const ok = quoteCart(storefront, [line(2), line(1)]);
    expect(ok.ok && ok.lines.every((l) => l.ok)).toBe(true);
    const over = quoteCart(storefront, [line(2), line(2)]);
    expect(over.ok && over.lines.every((l) => !l.ok && l.error === "Stok tersisa 3. Kurangi jumlahnya.")).toBe(true);
    // Tanpa stockLimit (katalog publik / produk racikan) → tidak dibatasi stok.
    const { stockLimit: _omit, ...publicProduct } = storefront.products[0];
    void _omit;
    const unlimited = quoteCart({ ...storefront, products: [publicProduct] }, [line(10)]);
    expect(unlimited.ok && unlimited.lines[0].ok).toBe(true);
  });
});

describe("rate limit checkout", () => {
  it("IP hanya dari header proxy tepercaya (tidak bisa dipalsukan)", () => {
    const spoofed = headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" });
    // Tanpa proxy tepercaya: header kiriman client diabaikan.
    expect(trustedClientIp(spoofed, {})).toBeNull();
    // Vercel menimpa header ini di edge.
    expect(trustedClientIp(headers({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }), { VERCEL: "1" })).toBe("203.0.113.7");
    expect(trustedClientIp(headers({ "x-real-ip": "203.0.113.8" }), { VERCEL: "1" })).toBe("203.0.113.8");
    // Self-host: header yang dikonfigurasi; entri paling kanan (ditulis proxy).
    expect(trustedClientIp(headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.2" }), { TRUSTED_IP_HEADER: "X-Forwarded-For" })).toBe("198.51.100.2");
    expect(trustedClientIp(headers({ "x-real-ip": "<script>" }), { TRUSTED_IP_HEADER: "x-real-ip" })).toBeNull();
    expect(trustedClientIp(headers({ "x-real-ip": "2001:db8::1" }), { TRUSTED_IP_HEADER: "x-real-ip" })).toBe("2001:db8::1");
  });

  it("aturan: perangkat ketat, IP longgar (Wi-Fi bersama), kiosk & retry terpisah", () => {
    const deviceId = newDeviceId();
    expect(readDeviceId(deviceId)).toBe(deviceId);
    expect(readDeviceId("x".repeat(500))).toBeNull();
    const rules = checkoutRules({ channel: "qr_table", outletCode: "sdy01", deviceId, ip: "203.0.113.1", replay: false });
    expect(rules).toEqual([
      { key: `checkout:device:${deviceId}`, limit: CHECKOUT_LIMITS.device, windowSeconds: 600 },
      { key: "checkout:ip:203.0.113.1", limit: CHECKOUT_LIMITS.ip, windowSeconds: 600 },
    ]);
    expect(CHECKOUT_LIMITS.ip).toBeGreaterThan(CHECKOUT_LIMITS.device * 5);
    expect(checkoutRules({ channel: "kiosk", outletCode: "SDY01", deviceId, ip: null, replay: false })).toEqual([
      { key: `checkout:device:${deviceId}`, limit: CHECKOUT_LIMITS.kioskDevice, windowSeconds: 600 },
      { key: "checkout:outlet:SDY01", limit: CHECKOUT_LIMITS.unknownIpPerOutlet, windowSeconds: 600 },
    ]);
    const replay = checkoutRules({ channel: "qr_table", outletCode: "SDY01", deviceId, ip: "203.0.113.1", replay: true });
    expect(replay.every((r) => r.key.startsWith("checkout-replay:"))).toBe(true);
  });
});
