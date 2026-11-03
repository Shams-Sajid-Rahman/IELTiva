"use client";

import { CheckCircle2, LogOut, MailWarning } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Container } from "@/components/layout/container";
import { Reveal } from "@/components/motion/reveal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "../auth-provider";

export function AccountSummary({ title, description }: { title: string; description: string }) {
  const t = useTranslations("auth");
  const { user, logout } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  if (!user) return null;

  async function signOut() {
    setPending(true);
    try {
      await logout();
    } catch {
      toast.error(t("signOutServerError"));
    }
    router.replace("/login");
  }

  return (
    <Container className="py-12 sm:py-16">
      <Reveal>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-medium sm:text-4xl">{t("welcome", { name: user.firstName })}</h1>
            <p className="text-muted-foreground mt-1 text-lg">{title}</p>
          </div>
          <Button variant="outline" onClick={signOut} disabled={pending}>
            <LogOut aria-hidden />
            {t("signOut")}
          </Button>
        </div>
        <p className="text-muted-foreground mt-4 max-w-2xl">{description}</p>

        {!user.emailVerified && (
          <Alert className="mt-6">
            <MailWarning aria-hidden />
            <AlertTitle>{t("unverifiedTitle")}</AlertTitle>
            <AlertDescription>
              <span>{t("unverifiedBody")}</span>
              <Link href="/verify-email" className="text-primary font-medium underline underline-offset-4">
                {t("resendLink")}
              </Link>
            </AlertDescription>
          </Alert>
        )}

        <Card className="shadow-soft mt-6 max-w-xl">
          <CardHeader>
            <CardTitle className="font-display text-xl font-medium">{t("accountTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-muted-foreground">{t("name")}</dt>
              <dd className="font-medium break-words">{user.firstName} {user.lastName}</dd>
              <dt className="text-muted-foreground">{t("email")}</dt>
              <dd className="font-medium break-words">{user.email}</dd>
              <dt className="text-muted-foreground">{t("emailStatus")}</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                {user.emailVerified ? (
                  <><CheckCircle2 className="text-success size-4" aria-hidden /> {t("verified")}</>
                ) : (
                  t("notVerified")
                )}
              </dd>
              <dt className="text-muted-foreground">{t("rolesLabel")}</dt>
              <dd className="flex flex-wrap gap-1.5">
                {user.roles.map((role) => (
                  <Badge key={role} variant="secondary">{t(`role.${role}`)}</Badge>
                ))}
              </dd>
            </dl>
          </CardContent>
        </Card>
      </Reveal>
    </Container>
  );
}
