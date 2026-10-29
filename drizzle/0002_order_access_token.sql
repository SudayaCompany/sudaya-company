ALTER TABLE "orders" ADD COLUMN "access_token_hash" text;--> statement-breakpoint
CREATE INDEX "orders_outlet_id_created_at_index" ON "orders" USING btree ("outlet_id","created_at");