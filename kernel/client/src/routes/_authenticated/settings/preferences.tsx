import { createFileRoute } from "@tanstack/react-router";

import { Appearance } from "#/modules/settings/appearance";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { SettingsSection } from "#/modules/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/preferences")({
	component: PreferencesRoute,
});

function PreferencesRoute() {
	const { theme } = Route.useRouteContext();
	return (
		<SettingsFrame title="Preferences" backFallbackHref="/settings">
			<SettingsSection title="Appearance" detail="Choose how Ryot looks on this device.">
				<Appearance theme={theme} />
			</SettingsSection>
		</SettingsFrame>
	);
}
