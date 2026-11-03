import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Use 1 when this is the main content of a page. */
  headingLevel?: 1 | 2;
};

export function EmptyState({ title, description, icon, action, className, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className={cn("mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-10 text-center", className)}>
      {icon && <div className="bg-accent text-accent-foreground ring-accent/40 animate-in zoom-in-90 fade-in-0 rounded-2xl p-3.5 ring-8 duration-300 [&_svg]:size-6">{icon}</div>}
      <Heading className="mt-2 text-xl font-semibold">{title}</Heading>
      {description && <p className="text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
