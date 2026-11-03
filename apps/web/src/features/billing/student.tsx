"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, CreditCard, Infinity as InfinityIcon, Loader2, Package as PackageIcon, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiRequestError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime } from "../platform/format";
import { useApiAction, useApiPage, useApiQuery } from "../platform/hooks";
import { Empty, FormDialog, LoadingBlocks, PageHeader, Pagination, QueryBoundary, TableFrame, TextAreaField, tdClass, thClass } from "../platform/ui";
import { formatMoney, isSafeGatewayUrl } from "./money";

export type Pack = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  validityDays: number | null;
  isFeatured: boolean;
  prices: { currency: string; amountMinor: number }[];
  features: { featureKey: string; quantity: number | null }[];
};

/** Plain list of what a package includes. */
function Features({ features, validityDays }: { features: Pack["features"]; validityDays: number | null }) {
  const t = useTranslations("billing");
  return (
    <ul className="space-y-1.5 text-sm">
      {features.map((feature) => (
        <li key={feature.featureKey} className="flex items-start gap-2">
          <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{feature.quantity === null ? t("unlimited", { feature: t(`features.${feature.featureKey}`) }) : t("count", { count: feature.quantity, feature: t(`features.${feature.featureKey}`) })}</span>
        </li>
      ))}
      <li className="text-muted-foreground flex items-start gap-2">
        <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{validityDays ? t("validFor", { days: validityDays }) : t("noExpiry")}</span>
      </li>
    </ul>
  );
}

export function PackagesPage() {
  const t = useTranslations("billing");
  const packages = useApiQuery<Pack[]>("/packages");
  return (
    <>
      <PageHeader title={t("packagesTitle")} description={t("packagesIntro")} actions={<Link href="/billing" className={buttonVariants({ variant: "outline" })}><CreditCard aria-hidden /> {t("myBilling")}</Link>} />
      <QueryBoundary query={packages}>
        {(items) =>
          items.length === 0 ? (
            <Empty title={t("noPackages")} description={t("noPackagesHint")} icon={<PackageIcon aria-hidden />} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <li key={item.id}>
                  <Card className={cn("shadow-soft h-full", item.isFeatured && "border-primary")}>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{t(`categories.${item.category}`)}</Badge>
                        {item.isFeatured && <Badge>{t("popular")}</Badge>}
                      </div>
                      <CardTitle className="font-display text-xl">{item.name}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex h-full flex-col gap-4">
                      {item.description && <p className="text-muted-foreground text-sm">{item.description}</p>}
                      <p className="font-display text-2xl font-semibold">
                        {item.prices.map((price) => formatMoney(price.amountMinor, price.currency)).join(" · ")}
                      </p>
                      <Features features={item.features} validityDays={item.validityDays} />
                      <Link href={`/packages/${item.id}`} className={cn(buttonVariants(), "mt-auto w-full")}>{t("viewDetails")}</Link>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )
        }
      </QueryBoundary>
    </>
  );
}

type Gateway = { code: string; name: string; currencies: string[]; sandbox: boolean };

export function PackageDetailPage() {
  const t = useTranslations("billing");
  const { id } = useParams<{ id: string }>();
  const pack = useApiQuery<Pack>(`/packages/${id}`);
  return (
    <QueryBoundary query={pack}>
      {(item) => (
        <>
          <PageHeader title={item.name} description={item.description ?? undefined} actions={<Link href="/packages" className={buttonVariants({ variant: "outline" })}>{t("allPackages")}</Link>} />
          <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
            <Card className="shadow-soft h-fit">
              <CardHeader>
                <CardTitle className="font-display text-lg">{t("whatsIncluded")}</CardTitle>
              </CardHeader>
              <CardContent>
                <Features features={item.features} validityDays={item.validityDays} />
                <p className="text-muted-foreground mt-4 text-sm">{t("creditsNote")}</p>
              </CardContent>
            </Card>
            <Checkout item={item} />
          </div>
        </>
      )}
    </QueryBoundary>
  );
}

function Checkout({ item }: { item: Pack }) {
  const t = useTranslations("billing");
  const [currency, setCurrency] = useState(item.prices[0]?.currency ?? "BDT");
  const [gateway, setGateway] = useState<string>("");
  // One key per visit to this page, so a double click or a retry opens the same payment, not a second one.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const gateways = useApiQuery<Gateway[]>(`/billing/gateways?currency=${currency}`);
  const price = item.prices.find((entry) => entry.currency === currency);
  const selected = gateways.data?.find((entry) => entry.code === gateway) ?? gateways.data?.[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ reference: string; redirectUrl: string }>("/billing/checkout", { packageId: item.id, currency, gateway: selected.code, idempotencyKey });
      if (!isSafeGatewayUrl(result.redirectUrl)) throw new Error("unsafe");
      window.location.assign(result.redirectUrl);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : t("checkoutFailed"));
      setBusy(false);
    }
  }

  return (
    <Card className="shadow-soft h-fit">
      <CardHeader>
        <CardTitle className="font-display text-lg">{t("checkout")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {item.prices.length > 1 && (
          <div role="radiogroup" aria-label={t("currency")} className="flex gap-2">
            {item.prices.map((entry) => (
              <Button key={entry.currency} type="button" role="radio" aria-checked={entry.currency === currency} variant={entry.currency === currency ? "default" : "outline"} size="sm" onClick={() => { setCurrency(entry.currency); setGateway(""); }}>
                {entry.currency}
              </Button>
            ))}
          </div>
        )}
        <p className="font-display text-3xl font-semibold" aria-live="polite">{price ? formatMoney(price.amountMinor, price.currency) : "-"}</p>
        <QueryBoundary query={gateways} loading={<LoadingBlocks count={1} />}>
          {(list) =>
            list.length === 0 ? (
              <p className="bg-muted flex items-start gap-2 rounded-lg p-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {t("noGateway")}</p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">{t("payWith")}</legend>
                {list.map((entry) => (
                  <label key={entry.code} className="has-[:checked]:border-primary flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm">
                    <input type="radio" name="gateway" value={entry.code} checked={(selected?.code ?? "") === entry.code} onChange={() => setGateway(entry.code)} />
                    <span className="flex-1">{entry.name}</span>
                    {entry.sandbox && <Badge variant="outline">{t("testMode")}</Badge>}
                  </label>
                ))}
              </fieldset>
            )
          }
        </QueryBoundary>
        {selected?.sandbox && <p className="text-muted-foreground text-sm">{t("testModeNote")}</p>}
        <p className="text-muted-foreground text-sm">{t("cardNote")}</p>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        <Button className="w-full" disabled={!selected || !price || busy} onClick={() => void pay()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <CreditCard aria-hidden />} {busy ? t("opening") : t("payNow")}
        </Button>
      </CardContent>
    </Card>
  );
}

type PaymentStatus = { reference: string; status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELED" | "REFUNDED"; amountMinor: number; currency: string; gateway: string; packageName: string; failureReason: string | null; createdAt: string; expiresAt: string | null };

function StatusInner() {
  const t = useTranslations("billing");
  const reference = useSearchParams().get("ref") ?? "";
  const valid = /^IELT[0-9a-f]{20}$/.test(reference);
  // The page asks the server, which asks the payment company. Nothing in the address bar can mark a payment as paid.
  const query = useQuery({
    queryKey: [`/billing/payments/${reference}/status`],
    queryFn: () => api.get<PaymentStatus>(`/billing/payments/${reference}/status`),
    enabled: valid,
    // Only asks again while the payment is still open.
    refetchInterval: (state) => (state.state.data?.status === "PENDING" ? 4000 : false),
  });
  if (!valid) return <Empty title={t("statusUnknown")} action={<Link href="/billing" className={buttonVariants()}>{t("myBilling")}</Link>} />;
  return (
    <QueryBoundary query={query}>
      {(data) => {
        const paid = data.status === "SUCCEEDED" || data.status === "REFUNDED";
        const open = data.status === "PENDING";
        return (
          <Card className="shadow-soft mx-auto max-w-xl">
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center" role="status" aria-live="polite">
              {open ? <Loader2 className="text-primary size-10 animate-spin" aria-hidden /> : paid ? <CheckCircle2 className="text-success size-10" aria-hidden /> : <XCircle className="text-destructive size-10" aria-hidden />}
              <h2 className="font-display text-2xl font-semibold">{open ? t("statusPending") : paid ? t("statusPaid") : t("statusNotPaid")}</h2>
              <p className="text-muted-foreground max-w-md text-sm">{open ? t("statusPendingBody") : paid ? t("statusPaidBody", { name: data.packageName }) : (data.failureReason ? (t.has(`reasons.${data.failureReason}`) ? t(`reasons.${data.failureReason}`) : t("statusNotPaidBody")) : t("statusNotPaidBody"))}</p>
              <dl className="bg-muted grid w-full grid-cols-2 gap-2 rounded-lg p-3 text-left text-sm">
                <dt className="text-muted-foreground">{t("amount")}</dt><dd className="text-right font-medium">{formatMoney(data.amountMinor, data.currency)}</dd>
                <dt className="text-muted-foreground">{t("method")}</dt><dd className="text-right">{data.gateway}</dd>
                <dt className="text-muted-foreground">{t("reference")}</dt><dd className="text-right break-all">{data.reference}</dd>
              </dl>
              <div className="flex flex-wrap justify-center gap-2">
                {paid && <Link href="/practice" className={buttonVariants()}>{t("startPracticing")}</Link>}
                {!paid && !open && <Link href="/packages" className={buttonVariants()}>{t("tryAgain")}</Link>}
                <Link href="/billing" className={buttonVariants({ variant: "outline" })}>{t("myBilling")}</Link>
              </div>
            </CardContent>
          </Card>
        );
      }}
    </QueryBoundary>
  );
}

export function PaymentStatusPage() {
  const t = useTranslations("billing");
  return (
    <>
      <PageHeader title={t("statusTitle")} />
      <Suspense fallback={<LoadingBlocks count={1} />}><StatusInner /></Suspense>
    </>
  );
}

type Credits = {
  totals: { featureKey: string; remaining: number; unlimited: boolean; nextExpiry: string | null }[];
  entitlements: { id: string; featureKey: string; packageName: string; status: string; unlimited: boolean; granted: number | null; used: number; remaining: number | null; endsAt: string | null }[];
};
type Purchase = { id: string; packageName: string; status: string; amountMinor: number; refundedMinor: number; currency: string; paidAt: string | null; createdAt: string; reference: string | null; gateway: string | null; refunds: { id: string; status: string; amountMinor: number }[]; canRequestRefund: boolean };

function CreditsTab() {
  const t = useTranslations("billing");
  const credits = useApiQuery<Credits>("/billing/credits");
  const [page, setPage] = useState(1);
  const history = useApiPage<{ id: string; featureKey: string; delta: number; reason: string; createdAt: string }>("/billing/credits/history", { page, pageSize: 10 });
  return (
    <div className="space-y-6">
      <QueryBoundary query={credits}>
        {(data) =>
          data.entitlements.length === 0 ? (
            <Empty title={t("noCredits")} description={t("noCreditsHint")} icon={<PackageIcon aria-hidden />} action={<Link href="/packages" className={buttonVariants()}>{t("browsePackages")}</Link>} />
          ) : (
            <>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {data.totals.map((row) => (
                  <li key={row.featureKey} className="bg-card shadow-soft rounded-xl border p-4">
                    <p className="text-muted-foreground text-sm">{t(`features.${row.featureKey}`)}</p>
                    <p className="font-display text-3xl font-semibold">{row.unlimited ? <InfinityIcon aria-label={t("unlimitedShort")} className="size-8" /> : row.remaining}</p>
                    {row.nextExpiry && <p className="text-muted-foreground text-sm">{t("expires", { date: formatDate(row.nextExpiry) })}</p>}
                  </li>
                ))}
              </ul>
              <section aria-labelledby="packs-heading">
                <h3 id="packs-heading" className="font-display mb-3 text-lg font-semibold">{t("yourPackages")}</h3>
                <ul className="space-y-3">
                  {data.entitlements.map((row) => {
                    const percent = row.granted ? Math.min(100, Math.round((row.used / row.granted) * 100)) : 0;
                    return (
                      <li key={row.id} className="bg-card shadow-soft rounded-xl border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium">{row.packageName} <span className="text-muted-foreground font-normal">· {t(`features.${row.featureKey}`)}</span></p>
                          <Badge variant={row.status === "ACTIVE" ? "default" : "outline"}>{t(`entitlementStatus.${row.status}`)}</Badge>
                        </div>
                        {row.unlimited ? (
                          <p className="text-muted-foreground mt-2 text-sm">{t("usedUnlimited", { used: row.used })}</p>
                        ) : (
                          <>
                            <Progress value={percent} className="mt-3" aria-label={t("usageOf", { feature: t(`features.${row.featureKey}`) })} />
                            <p className="text-muted-foreground mt-1 text-sm">{t("usedOf", { used: row.used, granted: row.granted ?? 0, remaining: row.remaining ?? 0 })}</p>
                          </>
                        )}
                        <p className="text-muted-foreground text-sm">{row.endsAt ? t("expires", { date: formatDate(row.endsAt) }) : t("noExpiry")}</p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          )
        }
      </QueryBoundary>
      <section aria-labelledby="history-heading">
        <h3 id="history-heading" className="font-display mb-3 text-lg font-semibold">{t("creditHistory")}</h3>
        <QueryBoundary query={history}>
          {(data) =>
            data.items.length === 0 ? (
              <Empty title={t("noHistory")} />
            ) : (
              <>
                <TableFrame label={t("creditHistory")}>
                  <thead><tr>{[t("date"), t("feature"), t("change"), t("reasonLabel")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                  <tbody>{data.items.map((row) => <tr key={row.id}><td className={tdClass}>{formatDateTime(row.createdAt)}</td><td className={tdClass}>{t(`features.${row.featureKey}`)}</td><td className={tdClass}>{row.delta > 0 ? `+${row.delta}` : row.delta === 0 ? t("noChange") : row.delta}</td><td className={tdClass}>{(t.has(`ledger.${row.reason}`) ? t(`ledger.${row.reason}`) : row.reason)}</td></tr>)}</tbody>
                </TableFrame>
                <Pagination meta={data.meta} onPage={setPage} />
              </>
            )
          }
        </QueryBoundary>
      </section>
    </div>
  );
}

function RefundButton({ purchase }: { purchase: Purchase }) {
  const t = useTranslations("billing");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const request = useApiAction(() => api.post("/billing/refunds", { purchaseId: purchase.id, reason }), t("refundRequested"));
  return (
    <FormDialog open={open} onOpenChange={setOpen} title={t("refundTitle")} description={t("refundIntro")} trigger={<Button variant="outline" size="sm">{t("requestRefund")}</Button>}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); request.mutate(undefined, { onSuccess: () => setOpen(false) }); }}>
        <TextAreaField label={t("refundReason")} value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={1000} required />
        <Button type="submit" disabled={request.isPending || reason.trim().length < 10}>{t("sendRequest")}</Button>
      </form>
    </FormDialog>
  );
}

function PurchasesTab() {
  const t = useTranslations("billing");
  const [page, setPage] = useState(1);
  const purchases = useApiPage<Purchase>("/billing/purchases", { page, pageSize: 10 });
  return (
    <QueryBoundary query={purchases}>
      {(data) =>
        data.items.length === 0 ? (
          <Empty title={t("noPurchases")} action={<Link href="/packages" className={buttonVariants()}>{t("browsePackages")}</Link>} />
        ) : (
          <>
            <TableFrame label={t("purchases")}>
              <thead><tr>{[t("date"), t("package"), t("amount"), t("statusLabel"), t("reference"), ""].map((heading, index) => <th key={`${heading}-${index}`} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td className={tdClass}>{formatDate(row.paidAt ?? row.createdAt)}</td>
                    <td className={tdClass}>{row.packageName}</td>
                    <td className={tdClass}>{formatMoney(row.amountMinor, row.currency)}{row.refundedMinor > 0 && <span className="text-muted-foreground block text-xs">{t("refunded", { amount: formatMoney(row.refundedMinor, row.currency) })}</span>}</td>
                    <td className={tdClass}><Badge variant="outline">{t(`purchaseStatus.${row.status}`)}</Badge>{row.refunds.some((refund) => ["REQUESTED", "APPROVED"].includes(refund.status)) && <span className="text-muted-foreground block text-xs">{t("refundInProgress")}</span>}</td>
                    <td className={cn(tdClass, "break-all")}>{row.reference ?? "-"}</td>
                    <td className={tdClass}>{row.canRequestRefund && <RefundButton purchase={row} />}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <Pagination meta={data.meta} onPage={setPage} />
          </>
        )
      }
    </QueryBoundary>
  );
}

export function BillingPage() {
  const t = useTranslations("billing");
  const client = useQueryClient();
  return (
    <>
      <PageHeader title={t("billingTitle")} description={t("billingIntro")} actions={<Link href="/packages" className={buttonVariants()}>{t("browsePackages")}</Link>} />
      <Tabs defaultValue="credits" onValueChange={() => void client.invalidateQueries({ queryKey: ["/billing/credits"] })}>
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="credits">{t("creditsTab")}</TabsTrigger>
          <TabsTrigger value="purchases">{t("purchasesTab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="credits" className="mt-4"><CreditsTab /></TabsContent>
        <TabsContent value="purchases" className="mt-4"><PurchasesTab /></TabsContent>
      </Tabs>
    </>
  );
}

