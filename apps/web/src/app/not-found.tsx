import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/feedback/empty-state";
import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { Button } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations();

  return (
    <SiteShell>
    <Container className="py-24">
      <EmptyState headingLevel={1}
        title={t("errors.notFoundTitle")}
        description={t("errors.notFoundBody")}
        action={
          <Button asChild>
            <Link href="/">{t("common.backHome")}</Link>
          </Button>
        }
      />
    </Container>
    </SiteShell>
  );
}
