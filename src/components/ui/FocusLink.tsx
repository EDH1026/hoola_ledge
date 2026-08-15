"use client";

import type { ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";

// v2.19 (배치 B, PRD §24.12) — a plain <a href="#id"> only scrolls; it
// doesn't reliably focus a form control across browsers. This is the one
// tiny client island a "빈 상태 → 입력 필드로 포커스 이동" action needs on
// an otherwise fully server-rendered page (참가자 추가 폼 등).
export function FocusLink({
  targetId,
  variant = "neutral",
  size = "sm",
  children,
}: {
  targetId: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={() => {
        const el = document.getElementById(targetId);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as HTMLElement | null)?.focus();
      }}
    >
      {children}
    </Button>
  );
}
