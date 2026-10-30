CREATE TYPE "public"."attendance_correction_kind" AS ENUM('missing_attendance', 'missing_check_out');--> statement-breakpoint
CREATE TYPE "public"."attendance_method" AS ENUM('biometric', 'manual_correction');--> statement-breakpoint
CREATE TYPE "public"."face_session_purpose" AS ENUM('enrollment', 'check_in', 'check_out');--> statement-breakpoint
CREATE TYPE "public"."face_session_status" AS ENUM('issued', 'consumed', 'failed');--> statement-breakpoint
ALTER TYPE "public"."approval_type" ADD VALUE 'attendance_correction';--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "attendance_correction_kind" NOT NULL,
	"business_date" date NOT NULL,
	"attendance_id" uuid,
	"requested_check_in_at" timestamp with time zone,
	"requested_check_out_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"approval_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_corrections_times_valid" CHECK ("attendance_corrections"."requested_check_in_at" is null or "attendance_corrections"."requested_check_out_at" > "attendance_corrections"."requested_check_in_at")
);
--> statement-breakpoint
ALTER TABLE "attendance_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"max_gps_accuracy_meter" integer DEFAULT 20 NOT NULL,
	"face_match_threshold" real,
	"liveness_threshold" real,
	"verification_provider" text,
	"policy_version" text DEFAULT '2026-10-30' NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_settings_accuracy_range" CHECK ("attendance_settings"."max_gps_accuracy_meter" between 1 and 1000),
	CONSTRAINT "attendance_settings_thresholds_non_negative" CHECK (("attendance_settings"."face_match_threshold" is null or "attendance_settings"."face_match_threshold" >= 0) and ("attendance_settings"."liveness_threshold" is null or "attendance_settings"."liveness_threshold" >= 0))
);
--> statement-breakpoint
ALTER TABLE "attendance_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "biometric_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"notice_version" text NOT NULL,
	"basis" text NOT NULL,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "biometric_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "face_verification_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"purpose" "face_session_purpose" NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"status" "face_session_status" DEFAULT 'issued' NOT NULL,
	"liveness_score" real,
	"match_score" real,
	"failure_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "face_verification_sessions_provider_providerSessionId_unique" UNIQUE("provider","provider_session_id")
);
--> statement-breakpoint
ALTER TABLE "face_verification_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendances" ALTER COLUMN "check_in_latitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendances" ALTER COLUMN "check_in_longitude" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "policy_version" text;--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "check_in_method" "attendance_method";--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "check_out_method" "attendance_method";--> statement-breakpoint
-- Baris lama (jika ada) tidak punya bukti biometrik → diberi label koreksi manual.
UPDATE "attendances" SET "check_in_method" = 'manual_correction' WHERE "check_in_method" IS NULL;--> statement-breakpoint
UPDATE "attendances" SET "check_out_method" = 'manual_correction' WHERE "check_out_at" IS NOT NULL AND "check_out_method" IS NULL;--> statement-breakpoint
ALTER TABLE "attendances" ALTER COLUMN "check_in_method" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "check_in_liveness_score" real;--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "check_in_verification_id" uuid;--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "check_out_liveness_score" real;--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "check_out_verification_id" uuid;--> statement-breakpoint
ALTER TABLE "attendances" ADD COLUMN "working_minutes" integer;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD COLUMN "consent_id" uuid;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD COLUMN "revoked_reason" text;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD COLUMN "provider_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "outside_duty_requests" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outside_duty_requests" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_attendance_id_attendances_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."attendances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_settings" ADD CONSTRAINT "attendance_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_verification_sessions" ADD CONSTRAINT "face_verification_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_verification_sessions" ADD CONSTRAINT "face_verification_sessions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_verification_sessions" ADD CONSTRAINT "face_verification_sessions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_verification_sessions" ADD CONSTRAINT "face_verification_sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_corrections_employee_id_business_date_index" ON "attendance_corrections" USING btree ("employee_id","business_date");--> statement-breakpoint
CREATE INDEX "biometric_consents_employee_id_index" ON "biometric_consents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "face_verification_sessions_employee_id_created_at_index" ON "face_verification_sessions" USING btree ("employee_id","created_at");--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_check_in_verification_id_face_verification_sessions_id_fk" FOREIGN KEY ("check_in_verification_id") REFERENCES "public"."face_verification_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_check_out_verification_id_face_verification_sessions_id_fk" FOREIGN KEY ("check_out_verification_id") REFERENCES "public"."face_verification_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD CONSTRAINT "face_enrollments_consent_id_biometric_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."biometric_consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD CONSTRAINT "face_enrollments_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD CONSTRAINT "face_enrollments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendances_employee_id_business_date_index" ON "attendances" USING btree ("employee_id","business_date");--> statement-breakpoint
CREATE UNIQUE INDEX "face_enrollments_one_active_per_employee" ON "face_enrollments" USING btree ("employee_id") WHERE "face_enrollments"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "outside_duty_requests_employee_id_duty_date_index" ON "outside_duty_requests" USING btree ("employee_id","duty_date");--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_attendance_radius_range" CHECK ("outlets"."attendance_radius_meter" between 1 and 1000);--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_coordinates_valid" CHECK (("outlets"."latitude" is null and "outlets"."longitude" is null) or ("outlets"."latitude" between -90 and 90 and "outlets"."longitude" between -180 and 180));--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_checkout_after_checkin" CHECK ("attendances"."check_out_at" is null or "attendances"."check_out_at" >= "attendances"."check_in_at");--> statement-breakpoint
ALTER TABLE "attendances" ADD CONSTRAINT "attendances_working_minutes_non_negative" CHECK ("attendances"."working_minutes" is null or "attendances"."working_minutes" >= 0);--> statement-breakpoint
ALTER TABLE "outside_duty_requests" ADD CONSTRAINT "outside_duty_window_valid" CHECK ("outside_duty_requests"."ends_at" is null or "outside_duty_requests"."starts_at" is null or "outside_duty_requests"."ends_at" > "outside_duty_requests"."starts_at");