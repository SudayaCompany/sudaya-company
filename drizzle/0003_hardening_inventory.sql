ALTER TYPE "public"."approval_type" ADD VALUE 'stock_opname';--> statement-breakpoint
ALTER TYPE "public"."inventory_item_kind" ADD VALUE 'packaging';--> statement-breakpoint
ALTER TYPE "public"."inventory_transaction_type" ADD VALUE 'opening';--> statement-breakpoint
ALTER TYPE "public"."inventory_transaction_type" ADD VALUE 'stock_out';--> statement-breakpoint
ALTER TYPE "public"."inventory_transaction_type" ADD VALUE 'reversal';--> statement-breakpoint
ALTER TYPE "public"."stock_opname_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TYPE "public"."stock_opname_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"reason" text NOT NULL,
	"reverses_id" uuid,
	"approval_id" uuid,
	"movement_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_adjustments_quantity_non_zero" CHECK ("inventory_adjustments"."quantity" <> 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_recipe_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_recipe_items_outletId_productId_itemId_unique" UNIQUE("outlet_id","product_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "product_recipe_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_items" ALTER COLUMN "purchase_price" SET DATA TYPE numeric(16, 4);--> statement-breakpoint
ALTER TABLE "inventory_transactions" ALTER COLUMN "unit_cost" SET DATA TYPE numeric(16, 4);--> statement-breakpoint
ALTER TABLE "stock_opname_items" ALTER COLUMN "actual_qty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_opname_items" ALTER COLUMN "variance" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "pending_payment_ttl_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "expiry_date" date;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
-- Backfill aman untuk baris ledger lama (jika ada) sebelum NOT NULL.
UPDATE "inventory_transactions" SET "idempotency_key" = 'legacy:' || "id"::text WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "reverses_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD COLUMN "effective_date" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "snapshot_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stock_opnames" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
-- Order lama yang masih menunggu bayar mendapat batas waktu default 15 menit.
UPDATE "orders" SET "expires_at" = "created_at" + interval '15 minutes' WHERE "status" = 'pending_payment' AND "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_reverses_id_inventory_transactions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_movement_id_inventory_transactions_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recipe_items" ADD CONSTRAINT "product_recipe_items_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expires_at_index" ON "rate_limit_counters" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_outlet_id_created_at_index" ON "inventory_adjustments" USING btree ("outlet_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_reverses_id_index" ON "inventory_adjustments" USING btree ("reverses_id");--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reverses_id_inventory_transactions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_items_outlet_id_is_active_index" ON "inventory_items" USING btree ("outlet_id","is_active");--> statement-breakpoint
CREATE INDEX "inventory_transactions_outlet_id_created_at_index" ON "inventory_transactions" USING btree ("outlet_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_opnames_outlet_id_status_index" ON "stock_opnames" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "orders_pending_expiry_idx" ON "orders" USING btree ("expires_at") WHERE "orders"."status" = 'pending_payment';--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reversesId_unique" UNIQUE("reverses_id");--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_outletId_idempotencyKey_unique" UNIQUE("outlet_id","idempotency_key");--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_pending_payment_ttl_range" CHECK ("outlets"."pending_payment_ttl_minutes" between 1 and 1440);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_stock_non_negative" CHECK ("inventory_items"."stock_qty" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_minimum_non_negative" CHECK ("inventory_items"."minimum_stock" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_quantity_non_zero" CHECK ("inventory_transactions"."quantity" <> 0);--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_balance_non_negative" CHECK ("inventory_transactions"."balance_after" >= 0);