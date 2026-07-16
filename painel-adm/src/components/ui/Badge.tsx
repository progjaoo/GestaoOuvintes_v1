import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "blue" | "green" | "yellow" | "red" | "gray";
}

const tones = {
  blue: "bg-indigo-50 text-genesis-primary ring-genesis-primary/15",
  green: "bg-emerald-50 text-emerald-700 ring-genesis-success/20",
  yellow: "bg-amber-50 text-amber-800 ring-genesis-warning/20",
  red: "bg-red-50 text-genesis-error ring-genesis-error/20",
  gray: "bg-neutral-100 text-genesis-muted ring-neutral-500/15",
};

export function Badge({ tone = "gray", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
