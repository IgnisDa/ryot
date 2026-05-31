import { createFileRoute } from "@tanstack/react-router";

import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/preferences")({
	component: PreferencesRoute,
});

function PreferencesRoute() {
	return <SettingsFrame title="Preferences" backFallbackHref="/settings" />;
}
