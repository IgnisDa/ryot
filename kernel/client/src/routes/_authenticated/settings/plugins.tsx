import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { PluginManagementPanel } from "#/modules/plugins/management/panel";
import {
	errorDetail,
	pluginManagementMutation,
	pluginManagementQuery,
} from "#/modules/plugins/management/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/plugins")({
	component: PluginManagement,
});

function PluginManagement() {
	const query = useRyotQuery(pluginManagementQuery, undefined);
	const mutation = useRyotMutation(pluginManagementMutation);
	const content = (() => {
		if (query.status === "pending") {
			return (
				<p role="status" className="text-sm text-text-muted">
					Loading installations…
				</p>
			);
		}
		if (query.status === "error") {
			return (
				<p role="alert" className="text-sm text-danger">
					{errorDetail(query.error)}
				</p>
			);
		}
		return (
			<PluginManagementPanel
				pending={mutation.isPending}
				installations={query.data ?? []}
				error={errorDetail(mutation.error)}
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
				<Button
					variant="secondary"
					onClick={query.refetch}
					className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-sm"
				>
					<AppIcon size={14} name="rotate-ccw" className="text-text" />
					Refresh
				</Button>
			}
		>
			{content}
		</SettingsFrame>
	);
}
