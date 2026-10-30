// CSV laporan absensi. Nilai yang diawali = + - @ (atau tab/CR) diberi
// awalan apostrof agar tidak dieksekusi sebagai formula di Excel/Sheets
// (CSV/formula injection, OWASP).

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined, separator: string) {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * format "csv": koma (standar). format "excel": titik koma + baris `sep=;`
 * agar Excel dengan locale Indonesia membaca kolom dengan benar. Keduanya
 * UTF-8 dengan BOM.
 */
export function toCsv(rows: (string | number | null | undefined)[][], format: "csv" | "excel" = "csv") {
  const separator = format === "excel" ? ";" : ",";
  const lines = rows.map((row) => row.map((cell) => csvCell(cell, separator)).join(separator));
  if (format === "excel") lines.unshift(`sep=${separator}`);
  return `﻿${lines.join("\r\n")}\r\n`;
}
