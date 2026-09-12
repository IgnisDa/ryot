import { useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import { StatusMessage } from "@ryot-app/client-ui-sdk";
import { createFileRoute } from "@tanstack/react-router";

import { AuthService } from "#/modules/auth/service";
import { DemoProtectionMessage, useIsDemoSession } from "#/modules/demo-protection";
import { Appearance } from "#/modules/settings/appearance";
import { PreferencesForm } from "#/modules/settings/preferences-form";
import {
	preferencesQuery,
	updatePreferencesMutation,
} from "#/modules/settings/preferences-service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { SettingsSection } from "#/modules/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/preferences")({
	component: PreferencesRoute,
});

function PreferencesRoute() {
	const { theme, server, runtime } = Route.useRouteContext();
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const preferences = useRyotQuery(preferencesQuery);
	const updatePreferences = useRyotMutation(updatePreferencesMutation);
	let content = <StatusMessage tone="pending">Loading your settings...</StatusMessage>;
	if (preferences.data !== undefined) {
		content = (
			<PreferencesForm
				disabled={isDemo}
				preferences={preferences.data}
				onSave={(payload) => updatePreferences.mutateEffect(payload)}
			/>
		);
	} else if (preferences.isError) {
		content = (
			<StatusMessage tone="error">
				Could not load your settings. Check the server and try again.
			</StatusMessage>
		);
	}

	return (
		<SettingsFrame title="Preferences" backFallbackHref="/settings">
			<div className="flex flex-col gap-8">
				<SettingsSection title="Appearance" detail="Choose how Ryot looks on this device.">
					<Appearance theme={theme} />
				</SettingsSection>
				<SettingsSection title="Content" detail="Control the metadata providers return.">
					{isDemo && <DemoProtectionMessage />}
					{content}
				</SettingsSection>
			</div>
		</SettingsFrame>
	);
}
