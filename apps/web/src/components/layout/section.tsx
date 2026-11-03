import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Container } from "./container";

type SectionProps = Omit<ComponentProps<"section">, "title"> & { title?: string; description?: ReactNode };

export function Section({ title, description, className, children, ...props }: SectionProps) {
  return (
    <section className={cn("scroll-mt-20 py-12 sm:py-16", className)} {...props}>
      <Container>
        {title && (
          <header className="mb-8 max-w-2xl">
            <h2 className="text-2xl font-medium sm:text-3xl">{title}</h2>
            {description && <p className="text-muted-foreground mt-2 leading-relaxed">{description}</p>}
          </header>
        )}
        {children}
      </Container>
    </section>
  );
}
