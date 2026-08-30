import {
	createRyotMutation,
	createRyotQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/client-sdk/react";
import { StatusMessage } from "@ryot-app/client-ui-sdk";
import type {
	UpdateUserPreferencesBody,
	UserPreferences,
} from "@ryot-app/contract/modules/user-settings/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { UserSettingsApi } from "#/api/user-settings";
import type { KernelHostServices } from "#/host-services";
import { EntityInterestService } from "#/modules/entity-interest/service";
import { Appearance } from "#/modules/settings/appearance";
import { PreferencesForm } from "#/modules/settings/preferences-form";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { SettingsSection } from "#/modules/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/preferences")({
	component: PreferencesRoute,
});

const preferencesQuery = createRyotQuery<void, UserPreferences, KernelHostServices>(
	({ signal, hostServices }) =>
		hostServices.runtime.runPromise(
			Effect.map(
				Effect.flatMap(UserSettingsApi, (api) => api.get(hostServices.scope)),
				(settings) => settings.preferences,
			),
			{ signal },
		),
);

const updatePreferencesMutation = createRyotMutation<
	UpdateUserPreferencesBody,
	UserPreferences,
	KernelHostServices
>(({ input, client, signal, hostServices }) =>
	hostServices.runtime.runPromise(
		Effect.flatMap(UserSettingsApi, (api) =>
			api.updatePreferences(hostServices.scope, { payload: input }),
		).pipe(
			Effect.tap(() =>
				input.language === undefined
					? Effect.void
					: Effect.map(EntityInterestService, (service) => service.reconnect(hostServices.scope)),
			),
			Effect.tap(() => Effect.sync(() => client.mutationCompleted.hint())),
		),
		{ signal },
	),
);

function PreferencesRoute() {
	const { theme } = Route.useRouteContext();
	const preferences = useRyotQuery(preferencesQuery);
	const updatePreferences = useRyotMutation(updatePreferencesMutation);
	let content = <StatusMessage tone="pending">Loading your settings...</StatusMessage>;
	if (preferences.data !== undefined) {
		content = (
			<PreferencesForm
				preferences={preferences.data}
				onSave={(payload) => updatePreferences.mutateAsync(payload)}
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
				<SettingsSection
					title="Content and data"
					detail="Control metadata and background connections."
				>
					{content}
				</SettingsSection>
			</div>
		</SettingsFrame>
	);
}
