import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/layout/app-providers";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "IELTiva", template: "%s | IELTiva" },
  description: "AI-assisted IELTS preparation.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#10141f" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations("common");

  return (
    <html lang={locale} className={`${inter.variable} ${fraunces.variable}`} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        <NextIntlClientProvider>
          <AppProviders>
            <a
              href="#main"
              className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
            >
              {t("skipToContent")}
            </a>
            <SiteHeader />
            <main id="main" tabIndex={-1} className="flex-1 outline-none">
              {children}
            </main>
            <SiteFooter />
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
