// Input checkout untuk semua channel. Hanya id, jumlah, catatan, dan data
// customer yang diterima dari client — harga & total dihitung server.

import { z } from "zod";

import { MAX_LINE_QUANTITY } from "@/lib/catalog/pricing";

/** "+62 812-3456-7890" / "6281234567890" → "081234567890" */
export function normalizePhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  if (digits.startsWith("+62")) return `0${digits.slice(3)}`;
  if (digits.startsWith("62")) return `0${digits.slice(2)}`;
  return digits;
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} maksimal ${max} karakter.` })
    .optional()
    .transform((v) => v || null);

export const checkoutLine = z.object({
  productId: z.uuid(),
  modifierIds: z.array(z.uuid()).max(30),
  quantity: z.int().min(1).max(MAX_LINE_QUANTITY),
  notes: optionalText(140, "Catatan item"),
});
export type CheckoutLine = z.infer<typeof checkoutLine>;

export const PUBLIC_CHANNELS = ["qr_table", "qr_counter", "website", "kiosk"] as const;

export const checkoutInput = z
  .object({
    /** Dibuat client sekali per percobaan checkout; retry memakai key sama. */
    idempotencyKey: z.uuid({ error: "Permintaan tidak valid. Muat ulang halaman." }),
    type: z.enum(["dine_in", "takeaway", "delivery"], { error: "Pilih tipe pesanan." }),
    customerName: optionalText(60, "Nama"),
    customerPhone: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? normalizePhone(v) : null))
      .refine((v) => v === null || /^08\d{7,12}$/.test(v), {
        error: "Nomor HP tidak valid (contoh 0812xxxxxxx).",
      }),
    tableNumber: z
      .string()
      .trim()
      .max(10, { error: "Nomor meja maksimal 10 karakter." })
      .refine((v) => /^[A-Za-z0-9-]*$/.test(v), { error: "Nomor meja hanya huruf, angka, dan '-'." })
      .optional()
      .transform((v) => v?.toUpperCase() || null),
    deliveryAddress: optionalText(300, "Alamat"),
    notes: optionalText(300, "Catatan pesanan"),
    paymentMethod: z.enum(["cash", "qris"], { error: "Pilih metode pembayaran." }),
    lines: z
      .array(checkoutLine)
      .min(1, { error: "Keranjang masih kosong." })
      .max(50, { error: "Maksimal 50 item per pesanan." }),
  })
  .superRefine((value, ctx) => {
    if (value.type === "delivery") {
      if (!value.customerPhone) {
        ctx.addIssue({ code: "custom", path: ["customerPhone"], message: "Nomor HP wajib untuk delivery." });
      }
      if (!value.deliveryAddress || value.deliveryAddress.length < 10) {
        ctx.addIssue({
          code: "custom",
          path: ["deliveryAddress"],
          message: "Alamat delivery wajib diisi lengkap (min. 10 karakter).",
        });
      }
    }
  });
export type CheckoutInput = z.infer<typeof checkoutInput>;

/** Channel publik (QR/web/kiosk) wajib mengisi nama pemesan. */
export function requireCustomerName(input: CheckoutInput) {
  if (!input.customerName || input.customerName.length < 2) {
    return "Nama pemesan wajib diisi (min. 2 karakter).";
  }
  return null;
}
