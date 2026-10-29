import type { ModifierGroupDraft } from "./modifier-group-editor";

/**
 * Template grup sesuai PRD §29–30. Harga hanya diisi bila PRD menyebutnya
 * (Extra Shot +5.000, Hazelnut Syrup +3.000); sisanya Rp 0 untuk diatur admin.
 * Template hanya mengisi form — tidak tersimpan sampai admin menekan Simpan.
 */
export const MODIFIER_PRESETS: Record<string, ModifierGroupDraft> = {
  size: {
    name: "Size",
    sortOrder: 0,
    selection: "single",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Regular", priceDelta: 0, isDefault: true, isActive: true },
      { name: "Large", priceDelta: 0, isDefault: false, isActive: true },
    ],
  },
  temperature: {
    name: "Hot/Ice",
    sortOrder: 1,
    selection: "single",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Ice", priceDelta: 0, isDefault: true, isActive: true },
      { name: "Hot", priceDelta: 0, isDefault: false, isActive: true },
    ],
  },
  sugar: {
    name: "Sugar Level",
    sortOrder: 2,
    selection: "single",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Normal", priceDelta: 0, isDefault: true, isActive: true },
      { name: "Less Sugar", priceDelta: 0, isDefault: false, isActive: true },
      { name: "No Sugar", priceDelta: 0, isDefault: false, isActive: true },
    ],
  },
  shot: {
    name: "Extra Shot",
    sortOrder: 3,
    selection: "multiple",
    isRequired: false,
    minSelect: 0,
    maxSelect: 2,
    options: [
      { name: "Extra Shot", priceDelta: 5000, isDefault: false, isActive: true },
      { name: "Decaf", priceDelta: 0, isDefault: false, isActive: true },
    ],
  },
  milk: {
    name: "Milk Options",
    sortOrder: 4,
    selection: "single",
    isRequired: false,
    minSelect: 0,
    maxSelect: 1,
    options: [
      { name: "Fresh Milk", priceDelta: 0, isDefault: true, isActive: true },
      { name: "Oat Milk", priceDelta: 0, isDefault: false, isActive: true },
    ],
  },
  topping: {
    name: "Topping",
    sortOrder: 5,
    selection: "multiple",
    isRequired: false,
    minSelect: 0,
    maxSelect: 3,
    options: [
      { name: "Cream", priceDelta: 0, isDefault: false, isActive: true },
      { name: "Hazelnut Syrup", priceDelta: 3000, isDefault: false, isActive: true },
    ],
  },
};
