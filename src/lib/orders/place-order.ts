// Client checkout guest → POST /api/orders (Route Handler dengan rate limit).
// Aman di-import dari browser: hanya fetch, tanpa dependency server.

export type PlaceOrderInput = {
  outlet: string;
  channel: "qr_table" | "qr_counter" | "website" | "kiosk";
  checkout: Record<string, unknown>;
};

export type PlaceOrderResult =
  | { ok: true; orderId: string; reference: string; total: number }
  | { ok: false; error: string; retryAfter?: number };

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as PlaceOrderResult | null;
    if (data && typeof data.ok === "boolean") return data;
    return { ok: false, error: "Pesanan gagal dikirim. Coba lagi." };
  } catch {
    // Idempotency key dipertahankan pemanggil → retry tidak membuat order ganda.
    return { ok: false, error: "Koneksi terputus. Periksa internet lalu coba lagi." };
  }
}
