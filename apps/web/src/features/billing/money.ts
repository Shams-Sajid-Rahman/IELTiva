import { currencyExponent, isSupportedCurrency, minorToMajor } from "@ieltiva/shared";

/** Shows a whole-number amount as money. The digits come from integer maths, so nothing is rounded. */
export function formatMoney(minor: number, currency: string) {
  if (!isSupportedCurrency(currency)) return `${minor} ${currency}`;
  const [whole, fraction] = minorToMajor(minor, currency).split(".");
  const grouped = new Intl.NumberFormat("en").format(BigInt(whole ?? "0"));
  const symbol = { BDT: "৳", USD: "$", EUR: "€", GBP: "£" }[currency];
  return currencyExponent[currency] > 0 ? `${symbol}${grouped}.${fraction}` : `${symbol}${grouped}`;
}

/** Turns what someone typed ("1250.5") into whole minor units, or null if it isn't a clean amount. */
export { parseMajorToMinor } from "@ieltiva/shared";

/** Only the gateway's own secure pages may receive the customer. */
export function isSafeGatewayUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}
