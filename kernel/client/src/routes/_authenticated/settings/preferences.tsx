import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
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
	const t = useT();
	const { theme, server, runtime } = Route.useRouteContext();
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const preferences = useRyotQuery(preferencesQuery);
	const updatePreferences = useRyotMutation(updatePreferencesMutation);
	let content = (
		<StatusMessage tone="pending">
			{t(kernelMessage("client.route.settings.preferences.loading"))}
		</StatusMessage>
	);
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
				{t(kernelMessage("client.route.settings.preferences.load-failed"))}
			</StatusMessage>
		);
	}

	return (
		<SettingsFrame
			backFallbackHref="/settings"
			title={t(kernelMessage("client.settings.section.preferences"))}
		>
			<div className="flex flex-col gap-8">
				<SettingsSection
					title={t(kernelMessage("client.settings.appearance.label"))}
					detail={t(kernelMessage("client.route.settings.preferences.appearance-detail"))}
				>
					<Appearance theme={theme} />
				</SettingsSection>
				{isDemo && <DemoProtectionMessage />}
				{content}
			</div>
		</SettingsFrame>
	);
}
