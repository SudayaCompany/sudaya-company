import { cn } from "@/lib/utils";

/**
 * Branding teks sementara. Logo resmi Sudaya Coffee belum ada di repo —
 * ganti komponen ini dengan <Image> dari asset resmi saat tersedia,
 * jangan menggambar ulang logo.
 */
export function Brand({
  className,
  tone = "dark",
}: {
  className?: string;
  tone?: "dark" | "light";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1.5 font-semibold tracking-tight",
        tone === "light" ? "text-white" : "text-foreground",
        className,
      )}
    >
      Sudaya
      <span className="text-brand">Coffee</span>
    </span>
  );
}
