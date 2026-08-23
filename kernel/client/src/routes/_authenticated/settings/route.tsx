import { createFileRoute, Outlet } from "@tanstack/react-router";

import { SettingsLayout } from "#/modules/settings/settings-layout";

export const Route = createFileRoute("/_authenticated/settings")({
	component: SettingsRoute,
});

function SettingsRoute() {
	return (
		<SettingsLayout>
			<Outlet />
		</SettingsLayout>
	);
}
