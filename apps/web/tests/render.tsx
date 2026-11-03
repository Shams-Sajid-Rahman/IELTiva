import { render } from "@testing-library/react";
import axe from "axe-core";
import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "next-themes";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import messages from "../messages/en.json";

export function renderUi(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <TooltipProvider>{ui}</TooltipProvider>
      </ThemeProvider>
    </NextIntlClientProvider>,
  );
}

export async function axeViolations(container: Element) {
  // Colour contrast needs real layout, so the Playwright suite covers it in both themes.
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.map((v) => v.id);
}
