import type { ReactNode } from "react";

/** Next.js remounts a template on every navigation, so each page fades in. The animation is CSS, so content stays visible without JavaScript. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300">{children}</div>;
}
