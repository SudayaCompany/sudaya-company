type RawSearchParams = Record<string, string | string[] | undefined>;

/** Ambil nilai pertama tiap search param (abaikan duplikat). */
export function firstValues(params: RawSearchParams) {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  ) as Record<string, string | undefined>;
}

/** Buat query string dari nilai yang terisi, mis. untuk link pagination. */
export function toQuery(values: Record<string, string | number | undefined | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}
