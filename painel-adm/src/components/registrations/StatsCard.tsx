import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatsCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "blue",
  loading = false,
}: {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  tone?: "blue" | "yellow" | "red";
  loading?: boolean;
}) {
  const tones = {
    blue: "bg-indigo-50 text-genesis-primary",
    yellow: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-genesis-error",
  };

  return (
    <article className="rounded-xl border border-genesis-border bg-genesis-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-genesis-muted">
            {label}
          </p>
          {loading ? (
            <div className="mt-3 h-10 w-20 animate-pulse rounded-md bg-neutral-100" />
          ) : (
            <p className="mt-2 font-display text-4xl font-semibold text-genesis-text">
              {value.toLocaleString("pt-BR")}
            </p>
          )}
          <p className="mt-2 text-xs text-genesis-muted">{hint}</p>
        </div>
        <div className={cn("grid h-11 w-11 place-items-center rounded-lg", tones[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}
