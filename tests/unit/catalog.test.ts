import { describe, expect, it } from "vitest";

import { detectImageType, readMenuImage } from "@/lib/catalog/images";
import {
  defaultSelection,
  priceSelection,
  selectionLimits,
  type PricingProduct,
} from "@/lib/catalog/pricing";
import { quoteCart, cartQuoteInput } from "@/lib/catalog/quote";
import { categoryInput, modifierGroupInput, productInput } from "@/lib/catalog/schemas";
import { slugify } from "@/lib/catalog/slug";
import type { Storefront } from "@/lib/catalog/storefront";
import { AccessError } from "@/lib/auth/errors";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const latte: PricingProduct = {
  id: id(1),
  name: "Iced Latte",
  price: 25000,
  isAvailable: true,
  groups: [
    {
      id: id(10),
      name: "Size",
      selection: "single",
      isRequired: true,
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: id(11), name: "Regular", priceDelta: 0 },
        { id: id(12), name: "Large", priceDelta: 6000 },
      ],
    },
    {
      id: id(20),
      name: "Topping",
      selection: "multiple",
      isRequired: false,
      minSelect: 0,
      maxSelect: 2,
      modifiers: [
        { id: id(21), name: "Extra Shot", priceDelta: 5000 },
        { id: id(22), name: "Hazelnut Syrup", priceDelta: 3000 },
        { id: id(23), name: "Cream", priceDelta: 0 },
      ],
    },
  ],
};

describe("pricing", () => {
  it("menghitung harga dasar + selisih modifier", () => {
    const result = priceSelection(latte, [id(12), id(21), id(22)]);
    expect(result).toMatchObject({ ok: true, unitPrice: 25000 + 6000 + 5000 + 3000 });
  });

  it("menolak grup wajib yang belum dipilih", () => {
    expect(priceSelection(latte, [])).toEqual({ ok: false, error: "Pilih Size." });
  });

  it("menolak pilihan melebihi maksimal", () => {
    const result = priceSelection(latte, [id(11), id(21), id(22), id(23)]);
    expect(result).toEqual({ ok: false, error: "Maksimal 2 pilihan untuk Topping." });
  });

  it("menolak dua pilihan di grup single", () => {
    expect(priceSelection(latte, [id(11), id(12)]).ok).toBe(false);
  });

  it("menolak id modifier yang bukan milik produk (manipulasi)", () => {
    expect(priceSelection(latte, [id(11), id(999)])).toEqual({
      ok: false,
      error: "Pilihan tidak valid untuk produk ini.",
    });
  });

  it("menolak produk sold out", () => {
    expect(priceSelection({ ...latte, isAvailable: false }, [id(11)]).ok).toBe(false);
  });

  it("harga tidak pernah negatif", () => {
    const discount: PricingProduct = {
      ...latte,
      price: 1000,
      groups: [{ ...latte.groups[1], modifiers: [{ id: id(30), name: "Promo", priceDelta: -5000 }] }],
    };
    expect(priceSelection(discount, [id(30)])).toMatchObject({ ok: true, unitPrice: 0 });
  });

  it("batas pilihan efektif & pilihan default", () => {
    expect(selectionLimits(latte.groups[0])).toEqual({ min: 1, max: 1 });
    expect(selectionLimits({ ...latte.groups[1], maxSelect: null })).toEqual({ min: 0, max: 3 });
    expect(defaultSelection(latte)).toEqual([id(11)]);
    expect(defaultSelection(latte, new Set([id(12)]))).toEqual([id(12)]);
  });
});

describe("quote keranjang (server-side pricing)", () => {
  const storefront: Storefront = {
    outlet: { id: id(100), code: "SDY01", name: "Outlet" },
    brand: { id: id(101), name: "Brand" },
    categories: [],
    products: [{ ...latte, slug: "iced-latte", description: null, imageUrl: null, categoryId: id(102), defaultModifierIds: [] }],
  };

  it("harga kiriman browser dibuang skema dan dihitung ulang", () => {
    const parsed = cartQuoteInput.parse({
      outlet: "SDY01",
      lines: [{ productId: id(1), modifierIds: [id(12)], quantity: 2, unitPrice: 1, total: 1 }],
    });
    expect(parsed.lines[0]).not.toHaveProperty("unitPrice");
    const quote = quoteCart(storefront, parsed.lines);
    expect(quote).toMatchObject({ ok: true, total: (25000 + 6000) * 2, itemCount: 2 });
  });

  it("produk tidak dikenal ditandai error dan tidak dihitung", () => {
    const quote = quoteCart(storefront, [{ productId: id(2), modifierIds: [], quantity: 1 }]);
    expect(quote).toMatchObject({ ok: true, total: 0, lines: [{ ok: false }] });
  });

  it("jumlah dibatasi 1–50", () => {
    const line = { productId: id(1), modifierIds: [], quantity: 0 };
    expect(cartQuoteInput.safeParse({ outlet: "SDY01", lines: [line] }).success).toBe(false);
    expect(cartQuoteInput.safeParse({ outlet: "SDY01", lines: [{ ...line, quantity: 51 }] }).success).toBe(false);
  });
});

describe("validasi input katalog (Zod)", () => {
  const base = {
    name: "Kopi Susu Gula Aren",
    categoryId: id(5),
    basePrice: "25000",
    isActive: true,
    modifierGroupIds: [id(10), id(10)],
  };

  it("slug dibuat dari nama, SKU dinormalisasi, grup unik", () => {
    const result = productInput.parse({ ...base, sku: "ks-aren" });
    expect(result).toMatchObject({ slug: "kopi-susu-gula-aren", sku: "KS-AREN", basePrice: 25000 });
    expect(result.modifierGroupIds).toEqual([id(10)]);
  });

  it("field di luar skema dibuang (anti mass assignment)", () => {
    const result = productInput.parse({ ...base, companyId: id(9), brandId: id(9), imagePath: "x", deletedAt: null });
    expect(result).not.toHaveProperty("companyId");
    expect(result).not.toHaveProperty("brandId");
    expect(result).not.toHaveProperty("imagePath");
  });

  it.each([
    ["negatif", "-1"],
    ["desimal", "1500.5"],
    ["terlalu besar", "10000001"],
    ["bukan angka", "abc"],
  ])("harga %s ditolak", (_label, basePrice) => {
    expect(productInput.safeParse({ ...base, basePrice }).success).toBe(false);
  });

  it("slug & SKU tidak valid ditolak", () => {
    expect(productInput.safeParse({ ...base, slug: "Bukan Slug!" }).success).toBe(false);
    expect(productInput.safeParse({ ...base, sku: "SKU SPASI" }).success).toBe(false);
  });

  it("kategori: slug otomatis", () => {
    expect(categoryInput.parse({ name: "Non Coffee" }).slug).toBe("non-coffee");
  });

  it("grup modifier: single dipaksa max 1, wajib dipaksa min ≥ 1", () => {
    const result = modifierGroupInput.parse({
      name: "Size",
      selection: "single",
      isRequired: true,
      minSelect: 0,
      maxSelect: 5,
      options: [{ name: "Regular", priceDelta: 0 }],
    });
    expect(result).toMatchObject({ maxSelect: 1, minSelect: 1 });
  });

  it("grup modifier: min > max atau min > jumlah opsi ditolak", () => {
    const group = {
      name: "Topping",
      selection: "multiple",
      isRequired: false,
      minSelect: 3,
      maxSelect: 2,
      options: [{ name: "A", priceDelta: 0 }, { name: "B", priceDelta: 0 }],
    };
    expect(modifierGroupInput.safeParse(group).success).toBe(false);
    expect(modifierGroupInput.safeParse({ ...group, maxSelect: 5 }).success).toBe(false);
  });
});

describe("foto menu", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const gif = new TextEncoder().encode("GIF89a......");

  it("tipe dideteksi dari isi file, bukan nama/MIME", () => {
    expect(detectImageType(png)?.contentType).toBe("image/png");
    expect(detectImageType(jpg)?.contentType).toBe("image/jpeg");
    expect(detectImageType(webp)?.contentType).toBe("image/webp");
    expect(detectImageType(svg)).toBeNull();
    expect(detectImageType(gif)).toBeNull();
  });

  it("SVG yang menyamar sebagai PNG ditolak", async () => {
    const fake = new File([svg], "foto.png", { type: "image/png" });
    await expect(readMenuImage(fake)).rejects.toBeInstanceOf(AccessError);
  });

  it("file > 2 MB ditolak, tanpa file → null", async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" });
    await expect(readMenuImage(big)).rejects.toThrow("2 MB");
    expect(await readMenuImage(null)).toBeNull();
    expect(await readMenuImage(new File([], "kosong.png"))).toBeNull();
  });
});

describe("slugify", () => {
  it.each([
    ["Kopi Susu Gula Aren", "kopi-susu-gula-aren"],
    ["  Matcha   Latte!! ", "matcha-latte"],
    ["Café Crème", "cafe-creme"],
    ["!!!", ""],
  ])("%j → %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
