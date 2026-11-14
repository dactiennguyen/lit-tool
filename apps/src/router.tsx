import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AccountsPage } from "@/features/accounts/accounts-page";
import { ChatPage } from "@/features/chat/chat-page";
import { OnlinePage } from "@/features/online/online-page";
import { ProfilePage } from "@/features/profile/profile-page";
import { SettingsPage } from "@/features/settings/settings-page";

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/accounts" });
  },
});

const accountsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/accounts", component: AccountsPage });
const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: "/profile", component: ProfilePage });
const onlineRoute = createRoute({ getParentRoute: () => rootRoute, path: "/online", component: OnlinePage });
const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: "/chat", component: ChatPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage });

const routeTree = rootRoute.addChildren([indexRoute, accountsRoute, profileRoute, onlineRoute, chatRoute, settingsRoute]);

// Hash history: the Tauri asset protocol has no server-side fallback for deep paths.
export const router = createRouter({ routeTree, history: createHashHistory() });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
