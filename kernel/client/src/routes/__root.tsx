// oxlint-disable-next-line import/no-unassigned-import
import "../styles/index.css";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { ThemeController } from "../modules/theme/controller";
import type { ThemePreference } from "../modules/theme/preference";
import type { ClientRuntime } from "../runtime";

export type RouterContext = {
	readonly runtime: ClientRuntime;
	readonly initialThemePreference: ThemePreference;
};

export const Route = createRootRouteWithContext<RouterContext>()({ component: RootComponent });

function RootComponent() {
	const { initialThemePreference, runtime } = Route.useRouteContext();
	return (
		<>
			<ThemeController initialPreference={initialThemePreference} runtime={runtime} />
			<Outlet />
		</>
	);
}
