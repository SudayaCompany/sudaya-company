// Skema input katalog. Hanya field yang didefinisikan di sini yang diterima
// dari client (anti mass assignment): company/brand/imagePath/harga efektif
// selalu ditentukan server.

import { z } from "zod";

import { SLUG_PATTERN, slugify } from "./slug";

export const MAX_PRICE = 10_000_000;

const uuid = z.uuid({ error: "ID tidak valid." });

const name = (min: number, max: number) =>
  z
    .string({ error: "Nama wajib diisi." })
    .trim()
    .min(min, { error: `Nama minimal ${min} karakter.` })
    .max(max, { error: `Nama maksimal ${max} karakter.` });

/** Slug opsional: kosong → dibuat dari nama. */
const optionalSlug = z
  .string()
  .trim()
  .toLowerCase()
  .max(80, { error: "Slug maksimal 80 karakter." })
  .refine((v) => v === "" || SLUG_PATTERN.test(v), {
    error: "Slug hanya huruf kecil, angka, dan tanda hubung.",
  })
  .optional();

const price = (label: string, min = 0) =>
  z.coerce
    .number({ error: `${label} harus berupa angka.` })
    .int({ error: `${label} harus bilangan bulat (Rupiah).` })
    .min(min, { error: `${label} minimal ${min}.` })
    .max(MAX_PRICE, { error: `${label} maksimal ${MAX_PRICE.toLocaleString("id-ID")}.` });

function withSlug<T extends { name: string; slug?: string }>(value: T) {
  const slug = value.slug || slugify(value.name);
  return { ...value, slug };
}

export const productInput = z
  .object({
    name: name(2, 120),
    slug: optionalSlug,
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .max(32, { error: "SKU maksimal 32 karakter." })
      .refine((v) => v === "" || /^[A-Z0-9][A-Z0-9-]*$/.test(v), {
        error: "SKU hanya huruf, angka, dan tanda hubung.",
      })
      .optional()
      .transform((v) => v || null),
    categoryId: uuid,
    description: z
      .string()
      .trim()
      .max(1000, { error: "Deskripsi maksimal 1000 karakter." })
      .optional()
      .transform((v) => v || null),
    basePrice: price("Harga"),
    isActive: z.boolean(),
    modifierGroupIds: z
      .array(uuid)
      .max(20, { error: "Maksimal 20 grup modifier." })
      .transform((ids) => [...new Set(ids)]),
  })
  .transform(withSlug)
  .refine((v) => v.slug.length > 0, {
    error: "Slug tidak bisa dibuat dari nama ini. Isi slug secara manual.",
    path: ["slug"],
  });
export type ProductInput = z.infer<typeof productInput>;

/** Ambil field produk dari FormData secara eksplisit (field lain diabaikan). */
export function productFormValues(form: FormData) {
  const text = (key: string) => {
    const v = form.get(key);
    return typeof v === "string" ? v : undefined;
  };
  return {
    name: text("name"),
    slug: text("slug"),
    sku: text("sku"),
    categoryId: text("categoryId"),
    description: text("description"),
    basePrice: text("basePrice"),
    isActive: form.get("isActive") === "on" || form.get("isActive") === "true",
    modifierGroupIds: form.getAll("modifierGroupIds").filter((v) => typeof v === "string"),
  };
}

export const categoryInput = z
  .object({
    name: name(2, 60),
    slug: optionalSlug,
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
    isActive: z.boolean().default(true),
  })
  .transform(withSlug)
  .refine((v) => v.slug.length > 0, {
    error: "Slug tidak bisa dibuat dari nama ini.",
    path: ["slug"],
  });
export type CategoryInput = z.infer<typeof categoryInput>;

export const modifierOptionInput = z.object({
  /** Ada = ubah opsi lama; kosong = opsi baru. */
  id: uuid.optional(),
  name: name(1, 60),
  priceDelta: z.coerce
    .number({ error: "Selisih harga harus angka." })
    .int({ error: "Selisih harga harus bilangan bulat." })
    .min(-1_000_000)
    .max(1_000_000),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const modifierGroupInput = z
  .object({
    name: name(2, 60),
    selection: z.enum(["single", "multiple"]),
    isRequired: z.boolean(),
    minSelect: z.coerce.number().int().min(0).max(20),
    maxSelect: z.coerce.number().int().min(1).max(20).nullable(),
    sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
    options: z
      .array(modifierOptionInput)
      .min(1, { error: "Tambahkan minimal satu pilihan." })
      .max(30, { error: "Maksimal 30 pilihan per grup." }),
  })
  .transform((v) => {
    // Normalisasi aturan pilihan agar konsisten.
    const maxSelect = v.selection === "single" ? 1 : v.maxSelect;
    const minSelect = v.isRequired ? Math.max(v.minSelect, 1) : v.minSelect;
    return { ...v, maxSelect, minSelect };
  })
  .refine((v) => v.maxSelect === null || v.minSelect <= v.maxSelect, {
    error: "Minimal pilihan tidak boleh melebihi maksimal.",
    path: ["minSelect"],
  })
  .refine((v) => v.minSelect <= v.options.filter((o) => o.isActive).length, {
    error: "Minimal pilihan melebihi jumlah opsi aktif.",
    path: ["minSelect"],
  })
  .refine(
    (v) => v.selection === "multiple" || v.options.filter((o) => o.isDefault).length <= 1,
    { error: "Grup pilihan tunggal hanya boleh punya satu default.", path: ["options"] },
  );
export type ModifierGroupInput = z.infer<typeof modifierGroupInput>;
