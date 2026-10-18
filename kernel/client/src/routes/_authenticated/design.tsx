import { createFileRoute, Navigate } from "@tanstack/react-router";

import { DesignSystemScreen } from "#/modules/design-system/screen";

// TODO: Remove this dev-only route, `#/modules/design-system`, and the plugin-ui-sdk components only it
// uses (`Tabs`, `Tooltip`, `Radio`) once the redesign is applied across the app.
export const Route = createFileRoute("/_authenticated/design")({ component: DesignSystemRoute });

function DesignSystemRoute() {
	const { theme } = Route.useRouteContext();
	if (!import.meta.env.DEV) {
		return <Navigate to="/" replace />;
	}
	return <DesignSystemScreen theme={theme} />;
}
