"use client";

import { featureKeys, packageCategories, parseMajorToMinor, supportedCurrencies, minorToMajor, type Currency } from "@ieltiva/shared";
import { Archive, Copy, CreditCard, Pencil, Plus, RefreshCw, Undo2 } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { StatCard } from "@/components/feedback/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/features/auth/auth-provider";
import { api } from "@/lib/api-client";
import { formatDate, formatDateTime } from "../platform/format";
import { useApiAction, useApiPage, useApiQuery, useDebounced } from "../platform/hooks";
import { ConfirmButton, Empty, FormDialog, InputField, PageHeader, Pagination, QueryBoundary, SearchField, SelectBox, TableFrame, TextAreaField, tdClass, thClass } from "../platform/ui";
import { formatMoney } from "./money";
import type { Pack } from "./student";

// ---------- Packages and pricing ----------

type AdminPack = Omit<Pack, "prices"> & { isActive: boolean; sortOrder: number; sold: number; prices: { currency: string; amountMinor: number; isActive: boolean }[] };

type FormState = {
  code: string;
  name: string;
  description: string;
  category: string;
  validityDays: string;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: string;
  features: Record<string, { on: boolean; quantity: string }>;
  prices: Record<string, string>;
};

function toForm(pack?: AdminPack): FormState {
  return {
    code: pack?.code ?? "",
    name: pack?.name ?? "",
    description: pack?.description ?? "",
    category: pack?.category ?? "CUSTOM",
    validityDays: pack?.validityDays ? String(pack.validityDays) : "",
    isActive: pack?.isActive ?? false,
    isFeatured: pack?.isFeatured ?? false,
    sortOrder: String(pack?.sortOrder ?? 100),
    features: Object.fromEntries(featureKeys.map((key) => {
      const found = pack?.features.find((feature) => feature.featureKey === key);
      return [key, { on: Boolean(found), quantity: found?.quantity ? String(found.quantity) : "" }];
    })),
    prices: Object.fromEntries(supportedCurrencies.map((currency) => {
      const found = pack?.prices.find((price) => price.currency === currency && price.isActive);
      return [currency, found ? minorToMajor(found.amountMinor, currency) : ""];
    })),
  };
}

function PackageForm({ pack, onDone }: { pack?: AdminPack; onDone: () => void }) {
  const t = useTranslations("billing");
  const [form, setForm] = useState(() => toForm(pack));
  const [error, setError] = useState<string | null>(null);
  const save = useApiAction((body: unknown) => (pack ? api.patch(`/admin/packages/${pack.id}`, body) : api.post("/admin/packages", body)), t("packageSaved"));

  function submit(event: FormEvent) {
    event.preventDefault();
    const prices: { currency: Currency; amountMinor: number; isActive: boolean }[] = [];
    for (const currency of supportedCurrencies) {
      const text = form.prices[currency]?.trim();
      if (!text) continue;
      // Prices are typed in normal units and converted with whole-number maths. A value that isn't clean is refused, never rounded.
      const minor = parseMajorToMinor(text, currency);
      if (minor === null) return setError(t("badPrice", { currency }));
      prices.push({ currency, amountMinor: minor, isActive: true });
    }
    const features = featureKeys.filter((key) => form.features[key]?.on).map((key) => ({ featureKey: key, quantity: form.features[key]?.quantity ? Number(form.features[key]?.quantity) : null }));
    setError(null);
    save.mutate(
      {
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category,
        validityDays: form.validityDays ? Number(form.validityDays) : null,
        isActive: form.isActive,
        isFeatured: form.isFeatured,
        sortOrder: Number(form.sortOrder) || 100,
        features,
        prices,
      },
      { onSuccess: onDone, onError: (caught) => setError(caught instanceof Error ? caught.message : t("packageFailed")) },
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <InputField label={t("name")} value={form.name} onChange={(event) => set("name", event.target.value)} required />
        <InputField label={t("code")} hint={t("codeHint")} value={form.code} onChange={(event) => set("code", event.target.value)} required disabled={Boolean(pack)} />
      </div>
      <TextAreaField label={t("description")} value={form.description} onChange={(event) => set("description", event.target.value)} maxLength={2000} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectBox label={t("category")} value={form.category} onChange={(event) => set("category", event.target.value)} options={packageCategories.map((value) => ({ value, label: t(`categories.${value}`) }))} />
        <InputField label={t("validity")} hint={t("validityHint")} type="number" min={1} max={3650} value={form.validityDays} onChange={(event) => set("validityDays", event.target.value)} />
        <InputField label={t("sortOrder")} type="number" min={0} value={form.sortOrder} onChange={(event) => set("sortOrder", event.target.value)} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("includes")}</legend>
        <p className="text-muted-foreground text-sm">{t("includesHint")}</p>
        {featureKeys.map((key) => (
          <div key={key} className="flex flex-wrap items-center gap-3">
            <label className="flex min-w-48 items-center gap-2 text-sm"><input type="checkbox" checked={form.features[key]?.on ?? false} onChange={(event) => set("features", { ...form.features, [key]: { on: event.target.checked, quantity: form.features[key]?.quantity ?? "" } })} /> {t(`features.${key}`)}</label>
            <InputField label={t("quantityFor", { feature: t(`features.${key}`) })} className="w-28" type="number" min={1} placeholder={t("unlimitedShort")} disabled={!form.features[key]?.on} value={form.features[key]?.quantity ?? ""} onChange={(event) => set("features", { ...form.features, [key]: { on: true, quantity: event.target.value } })} />
          </div>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("prices")}</legend>
        <p className="text-muted-foreground text-sm">{t("pricesHint")}</p>
        <div className="grid gap-3 sm:grid-cols-4">
          {supportedCurrencies.map((currency) => (
            <InputField key={currency} label={currency} inputMode="decimal" placeholder="0.00" value={form.prices[currency] ?? ""} onChange={(event) => set("prices", { ...form.prices, [currency]: event.target.value })} />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.isActive} onCheckedChange={(value) => set("isActive", value)} /> {t("onSale")}</label>
        <label className="flex items-center gap-2 text-sm"><Switch checked={form.isFeatured} onCheckedChange={(value) => set("isFeatured", value)} /> {t("popular")}</label>
      </div>
      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <Button type="submit" disabled={save.isPending}>{t("save")}</Button>
    </form>
  );
}

function PackageDialog({ pack }: { pack?: AdminPack }) {
  const t = useTranslations("billing");
  const [open, setOpen] = useState(false);
  return (
    <FormDialog open={open} onOpenChange={setOpen} title={pack ? t("editPackage") : t("newPackage")} trigger={pack ? <Button variant="outline" size="sm"><Pencil aria-hidden /> {t("edit")}</Button> : <Button><Plus aria-hidden /> {t("newPackage")}</Button>}>
      <PackageForm pack={pack} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

export function AdminPackagesPage() {
  const t = useTranslations("billing");
  const { hasPermission } = useAuth();
  const manage = hasPermission("payments.manage");
  const packages = useApiQuery<AdminPack[]>("/admin/packages");
  const archive = useApiAction((id: string) => api.delete(`/admin/packages/${id}`), t("packageArchived"));
  return (
    <>
      <PageHeader title={t("adminPackagesTitle")} description={t("adminPackagesIntro")} actions={manage ? <PackageDialog /> : undefined} />
      <QueryBoundary query={packages}>
        {(items) =>
          items.length === 0 ? (
            <Empty title={t("noPackagesAdmin")} description={t("noPackagesAdminHint")} />
          ) : (
            <TableFrame label={t("adminPackagesTitle")}>
              <thead><tr>{[t("name"), t("category"), t("prices"), t("includes"), t("statusLabel"), t("sold"), ""].map((heading, index) => <th key={`${heading}-${index}`} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td className={tdClass}><span className="font-medium">{row.name}</span><span className="text-muted-foreground block text-xs">{row.code}</span></td>
                    <td className={tdClass}>{t(`categories.${row.category}`)}</td>
                    <td className={tdClass}>{row.prices.filter((price) => price.isActive).map((price) => formatMoney(price.amountMinor, price.currency)).join(" · ") || "-"}</td>
                    <td className={tdClass}>{row.features.map((feature) => `${feature.quantity ?? "∞"} ${t(`features.${feature.featureKey}`)}`).join(", ")}</td>
                    <td className={tdClass}><Badge variant={row.isActive ? "default" : "outline"}>{row.isActive ? t("onSale") : t("draft")}</Badge></td>
                    <td className={tdClass}>{row.sold}</td>
                    <td className={tdClass}>
                      {manage && (
                        <div className="flex gap-2">
                          <PackageDialog pack={row} />
                          <ConfirmButton label={<Archive aria-hidden />} title={t("archiveTitle")} description={t("archiveBody")} confirmLabel={t("archive")} destructive onConfirm={() => archive.mutate(row.id)} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )
        }
      </QueryBoundary>
    </>
  );
}

// ---------- Payments: transactions, refunds, revenue ----------

type Transaction = { id: string; reference: string; status: string; amountMinor: number; currency: string; gateway: string; failureReason: string | null; createdAt: string; packageName: string; refundedMinor: number; user: { id: string; email: string } };

function TransactionsTab() {
  const t = useTranslations("billing");
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);
  const transactions = useApiPage<Transaction>("/admin/transactions", { page, pageSize: 20, status, search: debounced });
  const recheck = useApiAction((id: string) => api.post(`/admin/transactions/${id}/recheck`), t("rechecked"));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField value={search} onChange={(value) => { setSearch(value); setPage(1); }} label={t("searchTransactions")} />
        <SelectBox label={t("statusLabel")} className="w-44" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} options={[{ value: "", label: t("allStatuses") }, ...["PENDING", "SUCCEEDED", "FAILED", "CANCELED", "REFUNDED"].map((value) => ({ value, label: t(`paymentStatus.${value}`) }))]} />
      </div>
      <QueryBoundary query={transactions}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty title={t("noTransactions")} />
          ) : (
            <>
              <TableFrame label={t("transactionsTab")}>
                <thead><tr>{[t("date"), t("student"), t("package"), t("amount"), t("method"), t("statusLabel"), ""].map((heading, index) => <th key={`${heading}-${index}`} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td className={tdClass}>{formatDateTime(row.createdAt)}<span className="text-muted-foreground block max-w-40 text-xs break-all">{row.reference}</span></td>
                      <td className={tdClass}>{row.user.email}</td>
                      <td className={tdClass}>{row.packageName}</td>
                      <td className={tdClass}>{formatMoney(row.amountMinor, row.currency)}{row.refundedMinor > 0 && <span className="text-muted-foreground block text-xs">{t("refunded", { amount: formatMoney(row.refundedMinor, row.currency) })}</span>}</td>
                      <td className={tdClass}>{row.gateway}</td>
                      <td className={tdClass}><Badge variant="outline">{t(`paymentStatus.${row.status}`)}</Badge>{row.failureReason && <span className="text-muted-foreground block max-w-40 text-xs break-words">{row.failureReason}</span>}</td>
                      <td className={tdClass}>{hasPermission("payments.manage") && ["PENDING", "FAILED", "CANCELED"].includes(row.status) && <Button variant="outline" size="sm" disabled={recheck.isPending} onClick={() => recheck.mutate(row.id)}><RefreshCw aria-hidden /> {t("recheck")}</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
              <Pagination meta={data.meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </div>
  );
}

type Refund = { id: string; status: string; amountMinor: number; currency: string; reason: string | null; decisionNote: string | null; createdAt: string; purchaseAmountMinor: number; alreadyRefundedMinor: number; packageName: string; user: { email: string }; reference: string; gateway: string; canRefundAutomatically: boolean };

function DecisionDialog({ refund }: { refund: Refund }) {
  const t = useTranslations("billing");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(minorToMajor(refund.amountMinor, refund.currency as Currency));
  const [note, setNote] = useState("");
  const decide = useApiAction((body: { decision: "APPROVE" | "REJECT"; amountMinor?: number; note?: string | null }) => api.post(`/admin/refunds/${refund.id}/decision`, body), t("decisionSaved"));
  const run = (decision: "APPROVE" | "REJECT") => {
    const minor = parseMajorToMinor(amount, refund.currency as Currency);
    if (decision === "APPROVE" && minor === null) return toast.error(t("badPrice", { currency: refund.currency }));
    decide.mutate({ decision, ...(decision === "APPROVE" && minor !== null ? { amountMinor: minor } : {}), note: note.trim() || null }, { onSuccess: () => setOpen(false) });
  };
  return (
    <FormDialog open={open} onOpenChange={setOpen} title={t("decideTitle")} description={t("decideBody", { name: refund.packageName, email: refund.user.email })} trigger={<Button size="sm">{t("decide")}</Button>}>
      <div className="space-y-4">
        {refund.reason && <p className="bg-muted rounded-lg p-3 text-sm">{refund.reason}</p>}
        <InputField label={t("refundAmount", { currency: refund.currency })} hint={t("refundAmountHint", { max: formatMoney(refund.purchaseAmountMinor - refund.alreadyRefundedMinor, refund.currency) })} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        {!refund.canRefundAutomatically && <p className="text-muted-foreground text-sm">{t("manualRefundNote", { gateway: refund.gateway })}</p>}
        <TextAreaField label={t("noteToStudent")} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} />
        <div className="flex gap-2">
          <Button disabled={decide.isPending} onClick={() => run("APPROVE")}>{t("approve")}</Button>
          <Button variant="outline" disabled={decide.isPending} onClick={() => run("REJECT")}>{t("reject")}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

function CompleteDialog({ refund }: { refund: Refund }) {
  const t = useTranslations("billing");
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const complete = useApiAction((gatewayRefundId: string) => api.post(`/admin/refunds/${refund.id}/complete`, { gatewayRefundId }), t("refundCompleted"));
  return (
    <FormDialog open={open} onOpenChange={setOpen} title={t("markPaidBack")} description={t("markPaidBackBody")} trigger={<Button variant="outline" size="sm">{t("markPaidBack")}</Button>}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); complete.mutate(reference.trim(), { onSuccess: () => setOpen(false) }); }}>
        <InputField label={t("gatewayRefundReference")} value={reference} onChange={(event) => setReference(event.target.value)} minLength={3} required />
        <Button type="submit" disabled={complete.isPending}>{t("confirmRefundDone")}</Button>
      </form>
    </FormDialog>
  );
}

function RefundsTab() {
  const t = useTranslations("billing");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("REQUESTED");
  const refunds = useApiPage<Refund>("/admin/refunds", { page, pageSize: 20, status });
  const send = useApiAction((id: string) => api.post(`/admin/refunds/${id}/send`), t("refundSent"));
  return (
    <div className="space-y-4">
      <SelectBox label={t("statusLabel")} className="w-52" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} options={[{ value: "", label: t("allStatuses") }, ...["REQUESTED", "APPROVED", "COMPLETED", "REJECTED", "FAILED"].map((value) => ({ value, label: t(`refundStatus.${value}`) }))]} />
      <QueryBoundary query={refunds}>
        {(data) =>
          data.items.length === 0 ? (
            <Empty title={t("noRefunds")} icon={<Undo2 aria-hidden />} />
          ) : (
            <>
              <TableFrame label={t("refundsTab")}>
                <thead><tr>{[t("date"), t("student"), t("package"), t("amount"), t("statusLabel"), ""].map((heading, index) => <th key={`${heading}-${index}`} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td className={tdClass}>{formatDate(row.createdAt)}</td>
                      <td className={tdClass}>{row.user.email}</td>
                      <td className={tdClass}>{row.packageName}<span className="text-muted-foreground block max-w-48 text-xs break-words">{row.reason}</span></td>
                      <td className={tdClass}>{formatMoney(row.amountMinor, row.currency)}</td>
                      <td className={tdClass}><Badge variant="outline">{t(`refundStatus.${row.status}`)}</Badge>{row.decisionNote && <span className="text-muted-foreground block max-w-40 text-xs break-words">{row.decisionNote}</span>}</td>
                      <td className={tdClass}>
                        <div className="flex flex-wrap gap-2">
                          {row.status === "REQUESTED" && <DecisionDialog refund={row} />}
                          {["APPROVED", "FAILED"].includes(row.status) && row.canRefundAutomatically && <Button variant="outline" size="sm" disabled={send.isPending} onClick={() => send.mutate(row.id)}>{t("sendRefund")}</Button>}
                          {["APPROVED", "FAILED"].includes(row.status) && <CompleteDialog refund={row} />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
              <Pagination meta={data.meta} onPage={setPage} />
            </>
          )
        }
      </QueryBoundary>
    </div>
  );
}

type Revenue = { days: number; pendingRefunds: number; currencies: { currency: string; grossMinor: number; refundedMinor: number; netMinor: number; payments: number; refunds: number; averageOrderMinor: number; daily: { day: string; grossMinor: number; payments: number }[]; packages: { name: string; grossMinor: number; payments: number }[]; gateways: { name: string; grossMinor: number; payments: number }[] }[] };

function RevenueChart({ currency, data }: { currency: string; data: Revenue["currencies"][number]["daily"] }) {
  const t = useTranslations("billing");
  const reduced = useReducedMotion();
  const shortDay = (day: string) => new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(day));
  const rows = data.map((row) => ({ day: row.day, amount: Number(minorToMajor(row.grossMinor, currency as Currency).replace(/\.00$/, "")) }));
  return (
    <figure className="min-w-0">
      <figcaption className="font-display mb-3 font-semibold">{t("dailyRevenue", { currency })}</figcaption>
      <div className="h-56 overflow-hidden" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={24} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis width={56} stroke="var(--muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 13 }} labelFormatter={(label) => shortDay(String(label))} formatter={(value) => [`${currency} ${value}`, t("grossRevenue")]} />
            <Bar dataKey="amount" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={!reduced} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table>
          <caption>{t("dailyRevenue", { currency })}</caption>
          <thead><tr><th scope="col">{t("date")}</th><th scope="col">{t("grossRevenue")}</th></tr></thead>
          <tbody>{data.map((row) => <tr key={row.day}><td>{row.day}</td><td>{formatMoney(row.grossMinor, currency)}</td></tr>)}</tbody>
        </table>
      </div>
    </figure>
  );
}

function RevenueTab() {
  const t = useTranslations("billing");
  const [days, setDays] = useState("30");
  const revenue = useApiQuery<Revenue>(`/admin/revenue?days=${days}`);
  return (
    <div className="space-y-6">
      <SelectBox label={t("period")} className="w-48" value={days} onChange={(event) => setDays(event.target.value)} options={["7", "30", "90", "365"].map((value) => ({ value, label: t("lastDays", { days: value }) }))} />
      <QueryBoundary query={revenue}>
        {(data) =>
          data.currencies.length === 0 ? (
            <Empty title={t("noRevenue")} description={t("noRevenueHint")} icon={<CreditCard aria-hidden />} />
          ) : (
            <>
              {data.pendingRefunds > 0 && <p className="bg-card rounded-xl border p-4 text-sm">{t("pendingRefunds", { count: data.pendingRefunds })}</p>}
              {data.currencies.map((item) => (
                <section key={item.currency} aria-label={item.currency} className="space-y-4">
                  <h3 className="font-display text-lg font-semibold">{item.currency}</h3>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <StatCard label={t("grossRevenue")} value={formatMoney(item.grossMinor, item.currency)} hint={t("paymentsCount", { count: item.payments })} />
                    <StatCard label={t("refundsTotal")} value={formatMoney(item.refundedMinor, item.currency)} hint={t("refundsCount", { count: item.refunds })} />
                    <StatCard label={t("netRevenue")} value={formatMoney(item.netMinor, item.currency)} />
                    <StatCard label={t("averageOrder")} value={formatMoney(item.averageOrderMinor, item.currency)} />
                  </div>
                  <div className="bg-card shadow-soft rounded-xl border p-4"><RevenueChart currency={item.currency} data={item.daily} /></div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {[{ title: t("byPackage"), rows: item.packages }, { title: t("byGateway"), rows: item.gateways }].map((group) => (
                      <TableFrame key={group.title} label={group.title}>
                        <thead><tr>{[group.title, t("paymentsLabel"), t("grossRevenue")].map((heading) => <th key={heading} scope="col" className={thClass}>{heading}</th>)}</tr></thead>
                        <tbody>{group.rows.map((row) => <tr key={row.name}><td className={tdClass}>{row.name}</td><td className={tdClass}>{row.payments}</td><td className={tdClass}>{formatMoney(row.grossMinor, item.currency)}</td></tr>)}</tbody>
                      </TableFrame>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )
        }
      </QueryBoundary>
    </div>
  );
}

export function AdminPaymentsPage() {
  const t = useTranslations("billing");
  return (
    <>
      <PageHeader title={t("adminPaymentsTitle")} description={t("adminPaymentsIntro")} />
      <Tabs defaultValue="transactions">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="transactions">{t("transactionsTab")}</TabsTrigger>
          <TabsTrigger value="refunds">{t("refundsTab")}</TabsTrigger>
          <TabsTrigger value="revenue">{t("revenueTab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="transactions" className="mt-4"><TransactionsTab /></TabsContent>
        <TabsContent value="refunds" className="mt-4"><RefundsTab /></TabsContent>
        <TabsContent value="revenue" className="mt-4"><RevenueTab /></TabsContent>
      </Tabs>
    </>
  );
}

// ---------- Gateways ----------

type Gateway = { code: string; name: string; isEnabled: boolean; sandbox: boolean; credentialsPresent: boolean; supportsRefunds: boolean; currencies: string[]; supportedCurrencies: string[]; webhookUrl: string };

export function AdminGatewaysPage() {
  const t = useTranslations("billing");
  const gateways = useApiQuery<Gateway[]>("/admin/gateways");
  const update = useApiAction((input: { code: string; body: Record<string, unknown> }) => api.patch(`/admin/gateways/${input.code}`, input.body), t("gatewaySaved"));
  return (
    <>
      <PageHeader title={t("gatewaysTitle")} description={t("gatewaysIntro")} />
      <p className="bg-card mb-4 rounded-xl border p-4 text-sm">{t("sandboxOnly")}</p>
      <QueryBoundary query={gateways}>
        {(items) => (
          <ul className="grid gap-4 lg:grid-cols-2">
            {items.map((item) => (
              <li key={item.code} className="bg-card shadow-soft space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold">{item.name}</h2>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={item.credentialsPresent ? "default" : "outline"}>{item.credentialsPresent ? t("keysPresent") : t("keysMissing")}</Badge>
                    <Badge variant="outline">{item.sandbox ? t("testMode") : t("liveMode")}</Badge>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm"><Switch checked={item.isEnabled} disabled={update.isPending || (!item.isEnabled && !item.credentialsPresent)} onCheckedChange={(value) => update.mutate({ code: item.code, body: { isEnabled: value } })} /> {t("enabledForStudents")}</label>
                {!item.credentialsPresent && <p className="text-muted-foreground text-sm">{t("keysMissingHint")}</p>}
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">{t("currencies")}</legend>
                  <div className="flex flex-wrap gap-4">
                    {item.supportedCurrencies.map((currency) => (
                      <label key={currency} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={item.currencies.includes(currency)} onChange={(event) => update.mutate({ code: item.code, body: { currencies: event.target.checked ? [...item.currencies, currency] : item.currencies.filter((entry) => entry !== currency) } })} /> {currency}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="text-muted-foreground text-sm">{item.supportsRefunds ? t("autoRefunds") : t("manualRefunds")}</p>
                <div>
                  <p className="text-sm font-medium">{t("notificationUrl")}</p>
                  <div className="flex items-center gap-2">
                    <code className="bg-muted min-w-0 flex-1 rounded px-2 py-1 text-xs break-all">{item.webhookUrl}</code>
                    <Button variant="outline" size="icon" aria-label={t("copy")} onClick={() => void navigator.clipboard.writeText(item.webhookUrl).then(() => toast.success(t("copied")))}><Copy aria-hidden /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </>
  );
}
