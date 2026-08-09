// oxlint-disable-next-line import/no-unassigned-import
import "#/styles/index.css";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import type { BackInterceptors } from "#/modules/navigation/back-interceptors";
import { ThemeController } from "#/modules/theme/controller";
import type { ThemeStore } from "#/modules/theme/store";
import type { ClientRuntime } from "#/runtime";

export type RouterContext = {
	readonly theme: ThemeStore;
	readonly runtime: ClientRuntime;
	readonly backInterceptors: BackInterceptors;
};

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootComponent });

function RootComponent() {
	const { runtime, theme } = Route.useRouteContext();
	return (
		<>
			<ThemeController runtime={runtime} theme={theme} />
			<Outlet />
		</>
	);
}
