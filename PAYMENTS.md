# Payments

For developers and whoever sets up merchant accounts. Nothing here has been run: no gateway has been called, in sandbox or live, and no merchant account exists.

## How it works

IELTiva sells prepaid packages, with no recurring billing. A package has per-currency prices, a validity period and a list of features, each with a quantity or unlimited use.

1. The student chooses a package, currency and gateway. The amount always comes from our own price list.
2. The API creates a pending purchase and transaction, then opens a session with the gateway.
3. The student pays on the gateway's page. IELTiva never sees card numbers or CVV, and has nowhere to store them.
4. The gateway sends the browser back and notifies our server. **Neither of these marks anything as paid.** Each one only prompts a check.
5. The server asks the gateway directly what happened, then compares the reference, amount and currency exactly.
6. If everything matches, the transaction succeeds, the purchase is paid and credits are granted, all in one database transaction. A mismatch grants nothing and is flagged for a person to review.

If a notification goes missing, the payment still settles when the status page is reloaded, or when the worker's five-minute sweep runs.

## Gateways

| Gateway | Code | Currencies | Notification check | Refund | Source used |
|---|---|---|---|---|---|
| SSLCOMMERZ | `sslcommerz` | BDT, USD | MD5 `verify_sign`, then the validation API | API | [v4 documentation](https://developer.sslcommerz.com/doc/v4/) |
| aamarPay | `aamarpay` | BDT, USD | None published, so a lookup only | By hand in its dashboard | [API reference](https://aamarpay.readme.io/reference/overview) |
| Stripe (international) | `stripe` | USD, EUR, GBP | HMAC `Stripe-Signature`, five-minute tolerance | API | Known API, **not re-checked against current docs** |
| bKash | Not built | | | | Official docs at developer.bka.sh couldn't be reached, and community sources disagree |

To add a gateway, implement `PaymentProvider` in `apps/api/src/services/billing/provider.ts` and add it in `runtime.ts`. Checkout, fulfilment and refunds don't change.

### Check these against the gateway before relying on them

- **SSLCOMMERZ hash:** the algorithm comes from the widely used SDK convention, because the documentation page doesn't spell it out. A wrong algorithm would reject real notifications, though the status page and the sweep would still settle those payments.
- **SSLCOMMERZ lookup by transaction ID:** this is used when no validation ID is available. It isn't described on the v4 page I read.
- **SSLCOMMERZ required fields:** the gateway insists on address and phone fields. Until the profile collects them, we send clear placeholders, which may need changing.
- **aamarPay signature:** its notification page says messages are signed but not how. Ask aamarPay support, then add the check.
- **aamarPay status codes and amount fields:** the Search Transaction page shows only a successful example.

## Setup

1. Get sandbox credentials from each gateway. This needs your own accounts.
2. Put them in `.env`. They never go in the database.
3. Open **Admin → Payment gateways**, switch on a gateway and give it the notification address shown there.
4. Create a package in **Admin → Packages**. There are no sample packages or prices, because those are your decisions.

Credits don't apply to AI feedback until the `billing.enforce_credits` setting is true. Premium exams and courses need a package straight away.

### Going live

`PAYMENT_ALLOW_LIVE=false` keeps every gateway on its sandbox, and Stripe refuses non-test keys. Don't change it until sandbox payments have been tested, legal review is finished and the owner has approved. SSLCOMMERZ also requires your server's public IP to be registered before it accepts refunds.

## Safeguards

| Risk | Control |
|---|---|
| Fake success message | Results come only from a server-to-gateway check |
| Changed amount | Price read from our list, and the gateway's answer compared in whole minor units |
| Someone else's receipt | The gateway's reference must equal this transaction's own reference |
| Replayed notification | Each message is recorded once per gateway, and Stripe's timestamp limits how old it can be |
| Notification flood | Unknown references aren't stored, and the route is rate limited |
| Double payment or fulfilment | Idempotency key, reuse of an open payment, one successful payment per purchase (database rule), row lock while applying a result |
| Wrong status change | A database trigger stops confirmed payments going back, stops success without a recorded check, and stops amount changes |
| Over-refunding | Checked at approval, in the statement that records it, and by a database constraint |
| Self-approved refund | The person who requested a refund can't decide it |

**Known gap:** two simultaneous checkouts with different idempotency keys for the same package could both open payments. Each one is valid and verified, but the student could pay twice, and the second payment would need a refund.

## Money

Amounts are whole minor units (paisa, cents) stored as integers. Decimal strings from gateways are converted with string arithmetic, and a value that would need rounding is refused. Currencies are never added together, so revenue is reported per currency.

## Refunds

Student request (within `billing.refund_window_days`, default 7) → staff decision → gateway API or a manual refund → completed. A full refund ends what's left of the package. A partial refund leaves it active. The refund window is a placeholder until a refund policy is agreed.
