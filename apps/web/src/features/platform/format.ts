export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

/** Stored date-only values are UTC midnight, so they display in UTC to avoid showing the wrong day. */
export function formatPlainDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

export function formatMinutes(minutes: number | null | undefined) {
  if (!minutes) return "0m";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function fullName(person: { firstName?: string | null; lastName?: string | null } | null | undefined) {
  return `${person?.firstName ?? ""} ${person?.lastName ?? ""}`.trim();
}
