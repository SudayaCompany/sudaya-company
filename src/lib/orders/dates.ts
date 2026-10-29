/** Tanggal operasional (YYYY-MM-DD) di zona waktu outlet. */
export function businessDateIn(timezone: string, at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
