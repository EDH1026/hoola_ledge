import type { HTMLAttributes } from "react";

const PADDING_STYLES = {
  md: "p-4 sm:p-5",
  sm: "p-3 sm:p-4",
} as const;

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: keyof typeof PADDING_STYLES;
}

export function Card({
  padding = "md",
  className = "",
  children,
  ...props
}: CardProps) {
  return (
    <div
      {...props}
      className={`rounded-2xl border border-line bg-surface ${PADDING_STYLES[padding]} ${className}`}
    >
      {children}
    </div>
  );
}
