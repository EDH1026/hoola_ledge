"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

// Reads the nearest ancestor <form>'s pending state via useFormStatus, so a
// plain server-action form gets a disabled/"저장 중..." submit button without
// the page itself needing to be a Client Component or track state by hand —
// this is the guard against double-submits that PRD §24 (Task 4-7) asks for
// on the participants/rollback/adjustments forms.
export function SubmitButton({
  children,
  pendingText,
  variant,
  size,
  className,
}: {
  children: ReactNode;
  pendingText?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      pending={pending}
      pendingText={pendingText}
      className={className}
    >
      {children}
    </Button>
  );
}
