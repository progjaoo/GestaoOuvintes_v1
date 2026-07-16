import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "min-h-10 w-full rounded-md border border-genesis-border bg-genesis-surface px-3 text-base text-genesis-text shadow-none focus:border-genesis-primary focus:ring-4 focus:ring-genesis-primary/10 sm:text-sm",
      className,
    )}
    {...props}
  />
));

Select.displayName = "Select";
