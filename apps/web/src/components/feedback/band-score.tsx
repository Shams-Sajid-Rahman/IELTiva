import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Mirrors the API's band visibility states. The HIDDEN variant has no band property,
 * so an unvalidated score can't be passed to it and rendered by mistake.
 */
export type BandScoreProps =
  | { visibility: "HIDDEN" }
  | { visibility: "INTERNAL" | "PUBLIC"; band: number };

export function BandScore(props: BandScoreProps) {
  const t = useTranslations("band");

  if (props.visibility === "HIDDEN") {
    return (
      <div className="bg-muted flex items-start gap-3 rounded-lg p-4">
        <Info className="text-info mt-0.5 size-5 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">{t("hiddenTitle")}</p>
          <p className="text-muted-foreground text-sm">{t("hiddenBody")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card flex items-center gap-4 rounded-lg border p-4">
      <p className="font-display text-primary text-4xl font-medium tabular-nums">{props.band.toFixed(1)}</p>
      <div>
        <p className="font-medium">{t("label")}</p>
        <p className={props.visibility === "INTERNAL" ? "text-warning text-sm font-medium" : "text-muted-foreground text-sm"}>
          {props.visibility === "INTERNAL" ? t("internal") : t("estimate")}
        </p>
      </div>
    </div>
  );
}
