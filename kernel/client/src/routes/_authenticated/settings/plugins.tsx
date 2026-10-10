import { useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import {
	PluginManagementError,
	pluginManagementMutation,
	pluginManagementQuery,
} from "#/modules/plugins/management";
import { PluginManagementPanel } from "#/modules/plugins/management-panel";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/plugins")({
	component: PluginManagement,
});

function PluginManagement() {
	const query = useRyotQuery(pluginManagementQuery, undefined);
	const mutation = useRyotMutation(pluginManagementMutation);
	const content = (() => {
		if (query.status === "pending") {
			return <p role="status">Loading installations…</p>;
		}
		if (query.status === "error") {
			return (
				<p role="alert">
					{query.error instanceof PluginManagementError ? query.error.detail : query.error?.message}
				</p>
			);
		}
		return (
			<PluginManagementPanel
				pending={mutation.isPending}
				installations={query.data ?? []}
				error={
					mutation.error instanceof PluginManagementError
						? mutation.error.detail
						: mutation.error?.message
				}
				status={
					mutation.data
						? `Command accepted for ${mutation.data.id}. Current health and initialization are shown after refreshing state.`
						: undefined
				}
				onAction={(action) => {
					void Effect.runPromise(
						mutation.mutateEffect(action).pipe(
							Effect.tap(() => Effect.sync(query.refetch)),
							Effect.catch(() => Effect.void),
						),
					);
				}}
			/>
		);
	})();
	return (
		<SettingsFrame
			title="Plugins"
			backFallbackHref="/settings"
			actions={
				<Button variant="secondary" onClick={query.refetch}>
					Refresh state
				</Button>
			}
		>
			{content}
		</SettingsFrame>
	);
}
