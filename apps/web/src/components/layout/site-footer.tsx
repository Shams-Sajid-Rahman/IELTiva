import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { Container } from "./container";

export async function SiteFooter() {
  const t = await getTranslations("common");

  return (
    <footer className="border-t">
      <Container className="flex flex-col gap-3 py-8 sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <p className="text-muted-foreground max-w-xl text-sm sm:text-right">{t("disclaimer")}</p>
      </Container>
    </footer>
  );
}
