import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AccountsPage } from "@/features/accounts/accounts-page";
import { ChatPage } from "@/features/chat/chat-page";
import { OnlinePage } from "@/features/online/online-page";
import { OverviewPage } from "@/features/overview/overview-page";
import { ProfilePage } from "@/features/profile/profile-page";
import { SettingsPage } from "@/features/settings/settings-page";
import { isId } from "@/lib/validation";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/overview" });
  },
});

const overviewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/overview", component: OverviewPage });
const accountsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/accounts", component: AccountsPage });
const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: "/profile", component: ProfilePage });
const onlineRoute = createRoute({ getParentRoute: () => rootRoute, path: "/online", component: OnlinePage });
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
  // `to`: IM ID of the conversation to open (from the list, or a new one from a profile).
  validateSearch: (search: Record<string, unknown>): { to?: string } =>
    typeof search.to === "string" && isId(search.to) ? { to: search.to } : {},
});
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([indexRoute, overviewRoute, accountsRoute, profileRoute, onlineRoute, chatRoute, settingsRoute]);

// Hash history: the Tauri asset protocol has no server-side fallback for deep paths.
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
