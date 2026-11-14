import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveAccountProvider } from "@/lib/active-account";
import { router } from "@/router";
import { applyTheme, readStoredTheme, resolveTheme, ThemeProvider } from "@/lib/theme";
import "./index.css";

// Apply the saved theme before the first paint (no inline script: CSP forbids it).
applyTheme(resolveTheme(readStoredTheme()));

if (import.meta.env.DEV) {
  document.addEventListener("securitypolicyviolation", (e) => {
    console.error(`CSP blocked ${e.blockedURI || "inline"} (${e.violatedDirective})`);
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ActiveAccountProvider>
          <TooltipProvider>
            <RouterProvider router={router} />
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ActiveAccountProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
