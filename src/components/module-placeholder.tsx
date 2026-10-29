import { Badge } from "@/components/ui/badge";

/**
 * Halaman sementara untuk interface customer yang belum dibangun.
 * Sengaja tanpa link ke area staff/admin (kiosk & order bersifat publik).
 */
export function ModulePlaceholder({
  title,
  description,
  features,
}: {
  title: string;
  description: string;
  features: string[];
}) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <Badge className="bg-brand text-brand-foreground">Segera hadir</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {features.map((feature) => (
          <li key={feature} className="rounded-lg border px-3 py-2">
            {feature}
          </li>
        ))}
      </ul>
    </main>
  );
}
