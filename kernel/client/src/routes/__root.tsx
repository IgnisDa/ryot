// oxlint-disable-next-line import/no-unassigned-import
import "#/styles/index.css";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import type { KernelRyotClientStore } from "#/api/ryot-client";
import { DeviceLifecycle } from "#/modules/device/lifecycle";
import { KernelI18nProvider } from "#/modules/i18n/provider";
import type { I18nStore } from "#/modules/i18n/store";
import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import { MainViewProvider } from "#/modules/navigation/main-view";
import { PageTitleProvider } from "#/modules/navigation/page-title";
import { SkipToContentLink } from "#/modules/navigation/skip-link";
import { ThemeController } from "#/modules/theme/controller";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientRuntime } from "#/runtime";

export type RouterContext = {
	readonly i18n: I18nStore;
	readonly theme: ThemeStore;
	readonly runtime: ClientRuntime;
	readonly hostedOAuthQuery: () => string;
	readonly ryotClients: KernelRyotClientStore;
	readonly backInterceptors: BackInterceptors;
};

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootComponent });

function RootComponent() {
	const { i18n, theme, runtime } = Route.useRouteContext();
	return (
		<KernelI18nProvider store={i18n}>
			<PageTitleProvider>
				<DeviceLifecycle runtime={runtime} />
				<SkipToContentLink />
				<ThemeController theme={theme} runtime={runtime} />
				<MainViewProvider>
					<Outlet />
				</MainViewProvider>
			</PageTitleProvider>
		</KernelI18nProvider>
	);
}
