import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "min-h-10 w-full rounded-md border border-genesis-border bg-genesis-surface px-3 text-base text-genesis-text shadow-none placeholder:text-genesis-neutral focus:border-genesis-primary focus:ring-4 focus:ring-genesis-primary/10 sm:text-sm",
        className,
      )}
      {...props}
    />
  ),
);

Input.displayName = "Input";
