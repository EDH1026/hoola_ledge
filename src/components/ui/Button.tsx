import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "neutral" | "danger" | "ghost";
export type ButtonSize = "md" | "sm";

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:brightness-110",
  neutral: "bg-slate-800 text-content-sub hover:bg-slate-700",
  danger:
    "bg-red-500/15 text-red-300 border border-red-800/60 hover:bg-red-500/25",
  ghost: "text-content-sub hover:bg-slate-800",
};

// Only min-h is spec'd per size; sm additionally trims horizontal padding
// so a 36px-tall pill doesn't inherit the same px-4 built for 44px buttons.
const SIZE_STYLES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4",
  sm: "min-h-9 px-3",
};

// Exported so non-<button> elements styled as a button (e.g. a Link acting
// as the primary action) can reuse the exact same visual language instead of
// duplicating a hand-copied class string that'll drift from this one.
export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className = ""
): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none ${SIZE_STYLES[size]} ${VARIANT_STYLES[variant]} ${className}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pending?: boolean;
  pendingText?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  pendingText,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || pending}
      className={buttonClassName(variant, size, className)}
    >
      {pending ? (pendingText ?? children) : children}
    </button>
  );
}
