import { StatusMessage } from "@ryot-app/client-ui-sdk";
import type { UpdateUserPreferencesBody } from "@ryot-app/contract/modules/user-settings/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useRef, type ReactNode } from "react";

import { UserSettingsApi } from "#/api/user-settings";
import { Appearance } from "#/modules/settings/appearance";
import { PreferencesForm } from "#/modules/settings/preferences-form";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { SettingsSection } from "#/modules/settings/settings-section";

export const Route = createFileRoute("/_authenticated/settings/preferences")({
	component: PreferencesRoute,
	errorComponent: PreferencesLoadError,
	pendingComponent: PreferencesPending,
	loader: ({ abortController, context }) =>
		context.runtime.runPromise(
			Effect.map(
				Effect.flatMap(UserSettingsApi, (api) => api.get(context.scope)),
				(settings) => settings.preferences,
			),
			{ signal: abortController.signal },
		),
});

function PreferencesFrame(props: { readonly children: ReactNode }) {
	const { theme } = Route.useRouteContext();
	return (
		<SettingsFrame title="Preferences" backFallbackHref="/settings">
			<div className="flex flex-col gap-8">
				<SettingsSection title="Appearance" detail="Choose how Ryot looks on this device.">
					<Appearance theme={theme} />
				</SettingsSection>
				{props.children}
			</div>
		</SettingsFrame>
	);
}

function ContentAndData(props: { readonly children: ReactNode }) {
	return (
		<SettingsSection title="Content and data" detail="Control metadata and background connections.">
			{props.children}
		</SettingsSection>
	);
}

function PreferencesRoute() {
	const preferences = Route.useLoaderData();
	const { runtime, scope } = Route.useRouteContext();
	const controller = useRef(new AbortController());
	useEffect(() => () => controller.current.abort(), []);

	const save = (payload: UpdateUserPreferencesBody) =>
		runtime.runPromise(
			Effect.flatMap(UserSettingsApi, (api) => api.updatePreferences(scope, { payload })),
			{ signal: controller.current.signal },
		);

	return (
		<PreferencesFrame>
			<ContentAndData>
				<PreferencesForm onSave={save} preferences={preferences} />
			</ContentAndData>
		</PreferencesFrame>
	);
}

function PreferencesPending() {
	return (
		<PreferencesFrame>
			<ContentAndData>
				<StatusMessage tone="pending">Loading your settings...</StatusMessage>
			</ContentAndData>
		</PreferencesFrame>
	);
}

function PreferencesLoadError() {
	return (
		<PreferencesFrame>
			<ContentAndData>
				<StatusMessage tone="error">
					Could not load your settings. Check the server and try again.
				</StatusMessage>
			</ContentAndData>
		</PreferencesFrame>
	);
}
