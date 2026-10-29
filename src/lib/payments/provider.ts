// Abstraksi payment gateway (QRIS/e-wallet). Belum ada provider yang
// dikonfigurasi, jadi metode online tampil "belum tersedia" dan TIDAK ada
// jalur yang bisa menandai order lunas tanpa konfirmasi pembayaran sah.
//
// Saat Midtrans/Xendit dipasang:
// 1. Implementasikan PaymentProvider untuk provider tsb.
// 2. Webhook: verifikasi signature, simpan ke payment_webhook_events
//    (unique provider+event_id = idempotent), lalu konfirmasi pembayaran
//    lewat engine yang sama dengan cash (penguncian order + nomor antrean).

export type CreateChargeInput = {
  orderId: string;
  amount: number;
  description: string;
};

export type CreatedCharge = {
  providerReference: string;
  /** Payload QRIS / URL pembayaran untuk ditampilkan ke customer. */
  qrString?: string;
  paymentUrl?: string;
  expiresAt: Date;
};

export type VerifiedWebhookEvent = {
  eventId: string;
  providerReference: string;
  status: "paid" | "failed" | "expired";
  amount: number;
};

export interface PaymentProvider {
  readonly id: "midtrans" | "xendit";
  createCharge(input: CreateChargeInput): Promise<CreatedCharge>;
  /** Wajib memverifikasi signature; lempar error jika tidak valid. */
  verifyWebhook(request: Request): Promise<VerifiedWebhookEvent>;
}

/** null = belum dikonfigurasi. */
export function getOnlinePaymentProvider(): PaymentProvider | null {
  return null;
}

export type PaymentOption = { method: "cash" | "qris"; label: string; available: boolean; note: string };

export function paymentOptions(): PaymentOption[] {
  const online = getOnlinePaymentProvider() !== null;
  return [
    { method: "cash", label: "Tunai", available: true, note: "Bayar di kasir" },
    {
      method: "qris",
      label: "QRIS",
      available: online,
      note: online ? "Bayar dengan scan QRIS" : "Belum tersedia",
    },
  ];
}
