-- Aman untuk tabel yang sudah berisi: tambah nullable, isi, lalu NOT NULL.
ALTER TABLE "categories" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "categories" SET "slug" = "id"::text WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- Aman untuk tabel yang sudah berisi: tambah nullable, isi, lalu NOT NULL.
ALTER TABLE "products" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "products" SET "slug" = "id"::text WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sku" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_brand_slug_unique" ON "categories" USING btree ("brand_id","slug") WHERE "categories"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_brand_slug_unique" ON "products" USING btree ("brand_id","slug") WHERE "products"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "products_brand_sku_unique" ON "products" USING btree ("brand_id","sku") WHERE "products"."deleted_at" is null and "products"."sku" is not null;--> statement-breakpoint
CREATE INDEX "products_brand_id_category_id_index" ON "products" USING btree ("brand_id","category_id");