import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "./app-shell";
import { AccountsPage } from "@/features/accounts/components/accounts-page";
import { OutreachPage } from "@/features/outreach/components/outreach-page";
import { OverviewPage } from "@/features/overview/components/overview-page";
import { SettingsPage } from "@/features/settings/components/settings-page";
import {
  AccountWorkspace,
  ChatRoute,
  DiscoverRoute,
  FeedRoute,
  ProfileRoute,
} from "@/features/workspace/components/account-workspace";
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
const outreachRoute = createRoute({ getParentRoute: () => rootRoute, path: "/outreach", component: OutreachPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

/** One account's workspace; its tabs are the child routes. */
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/$accountId",
  component: AccountWorkspace,
});

const workspaceIndexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/account/$accountId/chat", params });
  },
});

const chatRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "chat",
  component: ChatRoute,
  // `to`: IM ID of the conversation to open (from the list, or a new one from a profile).
  validateSearch: (search: Record<string, unknown>): { to?: string } =>
    typeof search.to === "string" && isId(search.to) ? { to: search.to } : {},
});

const discoverRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "discover", component: DiscoverRoute });
const feedRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "feed", component: FeedRoute });
const profileRoute = createRoute({ getParentRoute: () => workspaceRoute, path: "profile", component: ProfileRoute });

const routeTree = rootRoute.addChildren([
  indexRoute,
  overviewRoute,
  accountsRoute,
  outreachRoute,
  settingsRoute,
  workspaceRoute.addChildren([workspaceIndexRoute, chatRoute, discoverRoute, feedRoute, profileRoute]),
]);

// Hash history: the Tauri asset protocol has no server-side fallback for deep paths.
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
