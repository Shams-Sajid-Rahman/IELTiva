import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-10 text-center", className)}>
      {icon && <div className="bg-accent text-accent-foreground rounded-full p-3 [&_svg]:size-6">{icon}</div>}
      <h2 className="text-2xl font-medium">{title}</h2>
      {description && <p className="text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
