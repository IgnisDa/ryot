// oxlint-disable-next-line import/no-unassigned-import
import "#/styles/index.css";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { KernelRyotClientStore } from "#/api/ryot-client";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import { PageTitleProvider } from "#/modules/navigation/page-title";
import { SkipToContentLink } from "#/modules/navigation/skip-link";
import { ThemeController } from "#/modules/theme/controller";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientRuntime } from "#/runtime";

export type RouterContext = {
	readonly theme: ThemeStore;
	readonly runtime: ClientRuntime;
	readonly ryotClients: KernelRyotClientStore;
	readonly backInterceptors: BackInterceptors;
};

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootComponent });

function RootComponent() {
	const { theme, runtime } = Route.useRouteContext();
	return (
		<PageTitleProvider>
			<SkipToContentLink />
			<ThemeController theme={theme} runtime={runtime} />
			<Outlet />
		</PageTitleProvider>
	);
}
