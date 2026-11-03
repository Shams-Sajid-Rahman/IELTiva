import { getRequestConfig } from "next-intl/server";

const defaultLocale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? "en";

export default getRequestConfig(async () => ({
  locale: defaultLocale,
  messages: (await import(`../../messages/${defaultLocale}.json`)).default,
}));
