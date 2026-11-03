"use client";

import { useTranslations } from "next-intl";
import { EmptyState } from "@/components/feedback/empty-state";
import { Container } from "@/components/layout/container";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations("errors");

  return (
    <Container className="py-24">
      <EmptyState headingLevel={1}
        title={t("errorTitle")}
        description={t("errorBody")}
        action={<Button onClick={reset}>{t("retry")}</Button>}
      />
    </Container>
  );
}
