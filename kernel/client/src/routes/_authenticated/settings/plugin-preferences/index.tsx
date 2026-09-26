import { useRyotQuery } from "@ryot-app/client-sdk/react";
import { StatusMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { Link, createFileRoute } from "@tanstack/react-router";

import { pluginUserSettingsQuery } from "#/modules/settings/plugin-preferences-service";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/plugin-preferences/")({
	component: PluginPreferencesRoute,
});

function PluginPreferencesRoute() {
	const settings = useRyotQuery(pluginUserSettingsQuery);
	let content = <StatusMessage tone="pending">Loading plugin preferences...</StatusMessage>;
	if (settings.data !== undefined) {
		content =
			settings.data.length === 0 ? (
				<p role="status" className="text-sm text-text-muted">
					No plugin preferences are available.
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
					{settings.data.map((setting) => (
						<li key={setting.id}>
							<Link
								params={{ installationId: setting.id }}
								to="/settings/plugin-preferences/$installationId"
								className="flex min-h-14 items-center gap-3 px-4 text-sm text-text hover:bg-surface-2"
							>
								<AppIcon size={18} name={setting.icon} className="shrink-0 text-text-muted" />
								<span className="min-w-0 flex-1 truncate">{setting.name}</span>
								<AppIcon size={15} name="chevron-right" className="text-text-subtle" />
							</Link>
						</li>
					))}
				</ul>
			);
	} else if (settings.isError) {
		content = (
			<StatusMessage tone="error">
				Could not load plugin preferences. Check the server and try again.
			</StatusMessage>
		);
	}

	return (
		<SettingsFrame title="Plugin preferences" backFallbackHref="/settings">
			{content}
		</SettingsFrame>
	);
}
