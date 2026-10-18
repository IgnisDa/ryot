import { createFileRoute, Navigate } from "@tanstack/react-router";

import { DesignSystemScreen } from "#/modules/design-system/screen";

// TODO: Remove this route and `#/modules/design-system` once the redesign is applied across the app.
export const Route = createFileRoute("/_authenticated/design")({ component: DesignSystemRoute });

function DesignSystemRoute() {
	const { theme } = Route.useRouteContext();
	if (!import.meta.env.DEV) {
		return <Navigate to="/" replace />;
	}
	return <DesignSystemScreen theme={theme} />;
}
