import type { PropsWithChildren } from "react";

type BadgeProps = PropsWithChildren<{
  tone?: "neutral" | "success" | "warning" | "danger";
}>;

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
