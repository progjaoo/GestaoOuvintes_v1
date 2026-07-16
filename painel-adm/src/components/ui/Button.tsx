import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-all duration-200 active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-genesis-primary text-white hover:bg-genesis-primary-hover",
        secondary: "bg-genesis-text text-white hover:bg-neutral-800",
        outline:
          "border border-genesis-border bg-genesis-surface text-genesis-text hover:border-genesis-primary/40 hover:bg-indigo-50",
        ghost: "text-genesis-muted hover:bg-neutral-100 hover:text-genesis-text",
        danger: "bg-genesis-error text-white hover:bg-red-600",
      },
      size: {
        default: "min-h-10 px-4",
        sm: "min-h-8 rounded-md px-3 text-xs",
        icon: "h-10 w-10 px-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);

Button.displayName = "Button";
