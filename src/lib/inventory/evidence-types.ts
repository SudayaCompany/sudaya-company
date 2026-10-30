// Konstanta bukti foto inventory yang aman dipakai di browser & server.
export const EVIDENCE_BUCKET = "inventory-evidence";
export const MAX_EVIDENCE_BYTES = 3 * 1024 * 1024;
export const EVIDENCE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Bukti pendukung tugas luar (bucket PRIVATE terpisah dari stok). */
export const ATTENDANCE_EVIDENCE_BUCKET = "attendance-evidence";
