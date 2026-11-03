import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return (
    <Card className="shadow-soft h-full">
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">{label}</p>
          <p className="font-display mt-1 text-3xl font-medium">{value}</p>
          {hint && <p className="text-muted-foreground mt-1 text-sm">{hint}</p>}
        </div>
        {icon && <div className="bg-accent text-accent-foreground shrink-0 rounded-lg p-2 [&_svg]:size-5">{icon}</div>}
      </CardContent>
    </Card>
  );
}
