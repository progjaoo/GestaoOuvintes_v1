import type { PropsWithChildren, ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends PropsWithChildren {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-genesis-text">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-semibold text-genesis-error">{error}</p>
      ) : hint ? (
        <p className="text-xs text-genesis-muted">{hint}</p>
      ) : null}
    </div>
  );
}
