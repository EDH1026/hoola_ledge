import type { ReactNode } from "react";

interface SectionTitleProps {
  children: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

/** Section heading (18px), replacing the 14-16px ad-hoc h2s across screens. */
export function SectionTitle({ children, description, action }: SectionTitleProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-content">{children}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-content-muted">{description}</p>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
