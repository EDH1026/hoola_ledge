import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

// title uses text-content (not -muted) so it still reads as a heading, not
// another line of caption text, even though this batch wires no real actions
// yet (real actions land in Batch B, PRD §24.12).
export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon && <div className="text-content-faint">{icon}</div>}
      <p className="text-sm text-content">{title}</p>
      {description && <p className="text-xs text-content-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
