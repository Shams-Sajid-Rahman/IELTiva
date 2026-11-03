"use client";

import type { PaginationMeta } from "@ieltiva/shared";
import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useLabels } from "./labels";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight break-words sm:text-[2rem]">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function LoadingBlocks({ count = 3 }: { count?: number }) {
  const t = useTranslations("app");
  return (
    <div role="status" aria-label={t("loading")} className="space-y-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTranslations("app");
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border p-8 text-center">
      <AlertTriangle className="text-destructive size-6" aria-hidden />
      <p className="font-medium">{error instanceof ApiRequestError ? error.message : t("we_couldn_t_load_this_please_try_again")}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {t("try_again")}
        </Button>
      )}
    </div>
  );
}

/** One place for the loading, error and ready states of every data view. */
export function QueryBoundary<T>({ query, loading, children }: { query: UseQueryResult<T>; loading?: ReactNode; children: (data: T) => ReactNode }) {
  if (query.isPending) return <>{loading ?? <LoadingBlocks />}</>;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  return <>{children(query.data)}</>;
}

export function Empty({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return <EmptyState className="py-12" icon={icon ?? <Inbox aria-hidden />} title={title} {...(description ? { description } : {})} {...(action ? { action } : {})} />;
}

export function Pagination({ meta, onPage }: { meta: PaginationMeta; onPage: (page: number) => void }) {
  const t = useTranslations("app");
  if (meta.total === 0) return null;
  return (
    <nav aria-label={t("pagination")} className="mt-4 flex items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {t("page_page_of_totalpages_total_total", { page: meta.page, totalPages: meta.totalPages, total: meta.total })}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="icon" aria-label={t("previous_page")} disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <Button variant="outline" size="icon" aria-label={t("next_page")} disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

export function SearchField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <Search className="text-muted-foreground absolute top-2.5 left-3 size-4" aria-hidden />
      <Input type="search" aria-label={label} placeholder={label} value={value} onChange={(event) => onChange(event.target.value)} className="pl-9" />
    </div>
  );
}

type Option = { value: string; label: string };

export function SelectBox({ label, options, hideLabel, error, className, id, ...props }: ComponentProps<"select"> & { label: string; options: Option[]; hideLabel?: boolean; error?: string | undefined }) {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={selectId} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </Label>
      <select
        id={selectId}
        aria-invalid={Boolean(error)}
        className="border-input bg-card text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md pointer-coarse:h-11 border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

export function TextAreaField({ label, error, id, ...props }: ComponentProps<typeof Textarea> & { label: string; error?: string | undefined }) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>{label}</Label>
      <Textarea id={fieldId} aria-invalid={Boolean(error)} {...props} />
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

export function InputField({ label, error, id, hint, ...props }: ComponentProps<typeof Input> & { label: string; error?: string | undefined; hint?: string }) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input id={fieldId} aria-invalid={Boolean(error)} {...props} />
      {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  PUBLISHED: "bg-success text-success-foreground",
  ACTIVE: "bg-success text-success-foreground",
  COMPLETED: "bg-primary text-primary-foreground",
  SUSPENDED: "bg-destructive text-destructive-foreground",
  CANCELED: "bg-muted text-muted-foreground",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  const { status: label } = useLabels();
  return (
    <Badge variant="secondary" className={STATUS_STYLES[status]}>
      {label(status)}
    </Badge>
  );
}

/** Asks first, so sensitive actions can't happen by accident. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
  disabled,
  variant = "outline",
  size = "sm",
}: {
  label: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  const t = useTranslations("app");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t("cancel")}</Button>
          </DialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel ?? t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FormDialog({
  trigger,
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : "sr-only"}>{description ?? title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Tables scroll inside their own area on narrow screens, so the page itself never scrolls sideways. */
export function TableFrame({ label, cards, children }: { label: string; cards?: boolean; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="bg-card shadow-soft overflow-x-auto rounded-xl border">
      <table role={cards ? "table" : undefined} className={cn("w-full text-left text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-muted/60 [&_tbody_tr:last-child_td]:border-b-0", cards ? "table-cards sm:min-w-[40rem]" : "min-w-[40rem]")}>{children}</table>
    </div>
  );
}

/** A table cell that keeps its label when the table turns into cards on small screens. */
export function CardCell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <td role="cell" data-label={label} className={cn(tdClass, className)}>{children}</td>;
}

export const thClass = "text-muted-foreground border-b px-4 py-3 text-xs font-semibold tracking-wide uppercase";
export const tdClass = "border-b px-4 py-3 align-middle";
