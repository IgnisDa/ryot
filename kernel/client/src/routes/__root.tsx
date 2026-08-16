// oxlint-disable-next-line import/no-unassigned-import
import "../styles/index.css";
import { Outlet, createRootRoute } from "@tanstack/react-router";

import { ThemeController, ThemePreferenceControl } from "../modules/theme/controller";

export const Route = createRootRoute({
	component: RootComponent,
});

function RootComponent() {
	return (
		<>
			<ThemeController />
			<ThemePreferenceControl />
			<Outlet />
		</>
	);
}
