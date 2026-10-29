-- Epic 04 — fungsi operasional database.
--
-- 1. Ledger stok append-only (trigger).
-- 2. Kedaluwarsa order belum dibayar (fungsi idempotent + pg_cron).
-- 3. Pembersihan counter rate limit (pg_cron).
--
-- Semua fungsi hanya bisa dieksekusi role server (postgres); EXECUTE dicabut
-- dari public/anon/authenticated agar tidak bisa dipanggil lewat REST/RPC.

-- 1. Ledger append-only -------------------------------------------------------
-- UPDATE/DELETE/TRUNCATE ditolak. Pengecualian HANYA untuk pembersihan data
-- test terisolasi: set_config('sudaya.ledger_maintenance', 'on', true) di
-- transaksi yang sama. Aplikasi tidak pernah memakainya.
CREATE OR REPLACE FUNCTION public.inventory_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF tg_op = 'DELETE' AND current_setting('sudaya.ledger_maintenance', true) = 'on' THEN
    RETURN old;
  END IF;
  RAISE EXCEPTION 'inventory_transactions bersifat append-only (%); koreksi wajib lewat movement reversal', tg_op
    USING errcode = 'P0001';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inventory_transactions_immutable"
  BEFORE UPDATE OR DELETE ON "public"."inventory_transactions"
  FOR EACH ROW EXECUTE FUNCTION public.inventory_ledger_immutable();--> statement-breakpoint
CREATE TRIGGER "inventory_transactions_no_truncate"
  BEFORE TRUNCATE ON "public"."inventory_transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_ledger_immutable();--> statement-breakpoint
REVOKE ALL ON FUNCTION public.inventory_ledger_immutable() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- 2. Kedaluwarsa order belum dibayar ------------------------------------------
-- Idempotent & aman dijalankan paralel:
-- - hanya order pending_payment + payment pending yang expires_at <= now();
-- - FOR UPDATE SKIP LOCKED: order yang sedang dikunci transaksi pembayaran
--   dilewati (diproses di putaran berikutnya bila memang masih pending);
-- - order yang sudah dibayar tidak pernah cocok dengan filter → tidak pernah
--   dibatalkan.
-- p_order_id: proses satu order saja (dipakai saat kasir mencoba membayar
-- order yang sudah lewat batas waktu, di dalam transaksi yang memegang lock).
CREATE OR REPLACE FUNCTION public.expire_pending_orders(
  p_limit integer DEFAULT 200,
  p_order_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  r record;
  expired_count integer := 0;
BEGIN
  FOR r IN
    SELECT o.id, o.company_id, o.brand_id, o.outlet_id, o.access_token_hash, o.expires_at
    FROM public.orders o
    WHERE o.status = 'pending_payment'
      AND o.payment_status = 'pending'
      AND o.expires_at IS NOT NULL
      AND o.expires_at <= now()
      AND (p_order_id IS NULL OR o.id = p_order_id)
    ORDER BY o.expires_at
    LIMIT greatest(p_limit, 1)
    FOR UPDATE OF o SKIP LOCKED
  LOOP
    UPDATE public.orders
       SET status = 'cancelled',
           payment_status = 'expired',
           cancelled_at = clock_timestamp(),
           cancel_reason = 'Batas waktu pembayaran habis',
           updated_at = now()
     WHERE id = r.id;

    UPDATE public.payments
       SET status = 'expired', updated_at = now()
     WHERE order_id = r.id AND status = 'pending';

    INSERT INTO public.audit_logs
      (company_id, brand_id, outlet_id, actor_id, action, entity_type, entity_id, before, after, reason)
    VALUES
      (r.company_id, r.brand_id, r.outlet_id, NULL, 'order.expired', 'order', r.id,
       jsonb_build_object('status', 'pending_payment', 'paymentStatus', 'pending'),
       jsonb_build_object('status', 'cancelled', 'paymentStatus', 'expired', 'expiresAt', r.expires_at),
       'Batas waktu pembayaran habis');

    -- Sinyal realtime tanpa data (sama dengan order engine).
    PERFORM realtime.send('{}'::jsonb, 'changed', 'outlet-orders:' || r.outlet_id::text, false);
    IF r.access_token_hash IS NOT NULL THEN
      PERFORM realtime.send('{}'::jsonb, 'changed', 'order:' || left(r.access_token_hash, 40), false);
    END IF;

    expired_count := expired_count + 1;
  END LOOP;
  RETURN expired_count;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.expire_pending_orders(integer, uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint

-- 3. Jadwal (pg_cron, berjalan di database — tidak bergantung serverless) ----
CREATE EXTENSION IF NOT EXISTS pg_cron;--> statement-breakpoint
-- cron.schedule dengan nama job yang sama = update (idempotent).
SELECT cron.schedule('sudaya-expire-pending-orders', '* * * * *', 'select public.expire_pending_orders(500)');--> statement-breakpoint
SELECT cron.schedule('sudaya-prune-rate-limits', '*/10 * * * *', 'delete from public.rate_limit_counters where expires_at < now()');
