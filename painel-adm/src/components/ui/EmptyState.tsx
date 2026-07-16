import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

export function EmptyState({ icon: Icon, title, description }: EmptyStateProps) {
  return (
    <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-genesis-border bg-genesis-surface/80 p-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-indigo-50 text-genesis-primary">
          <Icon className="h-6 w-6" />
        </div>
        <h3 className="mt-4 font-display text-lg font-semibold text-genesis-text">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-genesis-muted">{description}</p>
      </div>
    </div>
  );
}
