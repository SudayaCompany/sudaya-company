// Label tampilan absensi (modul murni, aman di browser).

export const APPROVAL_STATUS_LABELS = {
  pending: "Menunggu",
  approved: "Disetujui",
  rejected: "Ditolak",
  cancelled: "Dibatalkan",
} as const;

export const DASHBOARD_STATUS_LABELS = {
  working: "Sedang bekerja",
  checked_out: "Sudah check-out",
  not_checked_in: "Belum check-in",
} as const;

export const CORRECTION_KIND_LABELS = {
  missing_attendance: "Absensi tidak tercatat",
  missing_check_out: "Lupa / gagal check-out",
} as const;

export function formatMinutes(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} j ${m} m` : `${m} m`;
}
