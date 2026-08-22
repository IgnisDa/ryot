// oxlint-disable-next-line import/no-unassigned-import
import "../styles/index.css";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { ThemeController } from "../modules/theme/controller";
import type { ThemeStore } from "../modules/theme/store";
import type { ClientRuntime } from "../runtime";

export type RouterContext = {
	readonly runtime: ClientRuntime;
	readonly theme: ThemeStore;
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
