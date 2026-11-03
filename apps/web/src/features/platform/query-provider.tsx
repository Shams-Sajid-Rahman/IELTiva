"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/features/auth/auth-provider";
import { ApiRequestError } from "@/lib/api-client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (count, error) => !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) && count < 1,
          },
        },
      }),
  );

  // One person's cached data must never remain for the next person on a shared computer.
  useEffect(() => {
    if (!user) client.clear();
  }, [client, user]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
