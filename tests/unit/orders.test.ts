import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { guestOrderTopic, outletOrdersTopic } from "@/lib/orders/realtime";
import { checkoutInput, normalizePhone, requireCustomerName } from "@/lib/orders/schemas";
import {
  customerStatusLabel,
  formatOrderNumber,
  nextProductionStatus,
  orderReference,
  transitionKind,
} from "@/lib/orders/state";
import { createAccessToken, hashAccessToken, verifyAccessToken } from "@/lib/orders/tokens";
import { paymentOptions } from "@/lib/payments/provider";

const line = { productId: randomUUID(), modifierIds: [], quantity: 1 };
const base = { idempotencyKey: randomUUID(), type: "takeaway", customerName: "Andi", paymentMethod: "cash", lines: [line] };

describe("state machine order", () => {
  it("alur produksi normal", () => {
    expect(transitionKind("queued", "preparing")).toBe("normal");
    expect(transitionKind("preparing", "ready")).toBe("normal");
    expect(transitionKind("ready", "completed")).toBe("normal");
    expect(nextProductionStatus("queued")).toBe("preparing");
    expect(nextProductionStatus("completed")).toBeNull();
  });

  it("mundur satu langkah = override; lompatan & status final ditolak", () => {
    expect(transitionKind("ready", "preparing")).toBe("override");
    expect(transitionKind("preparing", "queued")).toBe("override");
    for (const [from, to] of [
      ["queued", "ready"],
      ["queued", "completed"],
      ["completed", "preparing"],
      ["completed", "ready"],
      ["cancelled", "preparing"],
      ["pending_payment", "preparing"],
      ["pending_payment", "queued"],
    ] as const) {
      expect(transitionKind(from, to), `${from}→${to}`).toBeNull();
    }
  });

  it("label status customer", () => {
    expect(customerStatusLabel("pending_payment")).toBe("Menunggu pembayaran");
    expect(customerStatusLabel("queued")).toBe("Pesanan diterima");
    expect(customerStatusLabel("preparing")).toBe("Sedang dibuat");
    expect(customerStatusLabel("ready")).toBe("Siap diambil");
    expect(customerStatusLabel("completed")).toBe("Selesai");
    expect(customerStatusLabel("cancelled")).toBe("Dibatalkan");
  });

  it("nomor antrean & kode referensi", () => {
    expect(formatOrderNumber("SDY", 1)).toBe("SDY-001");
    expect(formatOrderNumber("SDY", 27)).toBe("SDY-027");
    expect(formatOrderNumber("SDY", 1234)).toBe("SDY-1234");
    expect(orderReference("a3bd1f28-c3cc-48b6-a8a6-9b3b94eeccbd")).toBe("A3BD1F");
  });
});

describe("validasi checkout", () => {
  it("normalisasi nomor HP Indonesia", () => {
    expect(normalizePhone("+62 812-3456-7890")).toBe("081234567890");
    expect(normalizePhone("6281234567890")).toBe("081234567890");
    expect(normalizePhone("0812 3456 7890")).toBe("081234567890");
  });

  it("delivery wajib HP & alamat; dine-in/takeaway HP opsional", () => {
    expect(checkoutInput.safeParse({ ...base, type: "delivery" }).success).toBe(false);
    expect(
      checkoutInput.safeParse({ ...base, type: "delivery", customerPhone: "081234567890", deliveryAddress: "Jl. Merdeka No. 10" }).success,
    ).toBe(true);
    expect(checkoutInput.safeParse({ ...base, type: "dine_in", tableNumber: "t03" }).data?.tableNumber).toBe("T03");
    expect(checkoutInput.safeParse({ ...base, customerPhone: "123" }).success).toBe(false);
  });

  it("field harga/total dari browser dibuang skema", () => {
    const parsed = checkoutInput.parse({ ...base, total: 1, subtotal: 1, lines: [{ ...line, unitPrice: 1, lineTotal: 1 }] });
    expect(parsed).not.toHaveProperty("total");
    expect(parsed.lines[0]).not.toHaveProperty("unitPrice");
  });

  it("batas jumlah, keranjang kosong, idempotency key wajib UUID", () => {
    expect(checkoutInput.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(checkoutInput.safeParse({ ...base, lines: [{ ...line, quantity: 51 }] }).success).toBe(false);
    expect(checkoutInput.safeParse({ ...base, idempotencyKey: "123" }).success).toBe(false);
    expect(checkoutInput.safeParse({ ...base, tableNumber: "T<script>" }).success).toBe(false);
  });

  it("nama wajib untuk channel publik", () => {
    expect(requireCustomerName(checkoutInput.parse({ ...base, customerName: undefined }))).not.toBeNull();
    expect(requireCustomerName(checkoutInput.parse(base))).toBeNull();
  });
});

describe("token guest & realtime", () => {
  it("hanya hash yang disimpan; verifikasi timing-safe", () => {
    const { token, hash } = createAccessToken();
    expect(hash).toBe(hashAccessToken(token));
    expect(hash).not.toContain(token);
    expect(verifyAccessToken(token, hash)).toBe(true);
    expect(verifyAccessToken(`${token}x`, hash)).toBe(false);
    expect(verifyAccessToken(undefined, hash)).toBe(false);
    expect(verifyAccessToken(token, null)).toBe(false);
    expect(verifyAccessToken("a".repeat(500), hash)).toBe(false);
  });

  it("topik guest tidak bisa diturunkan dari id order", () => {
    const { hash } = createAccessToken();
    const topic = guestOrderTopic(hash);
    expect(topic).toMatch(/^order:[0-9a-f]{40}$/);
    expect(outletOrdersTopic("abc")).toBe("outlet-orders:abc");
  });

  it("pembayaran online belum tersedia tanpa provider", () => {
    expect(paymentOptions()).toEqual([
      expect.objectContaining({ method: "cash", available: true }),
      expect.objectContaining({ method: "qris", available: false, note: "Belum tersedia" }),
    ]);
  });
});
