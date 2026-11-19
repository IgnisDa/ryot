import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { createFileRoute, Link } from "@tanstack/react-router";

import { pluginUserSettingsQuery } from "#/modules/settings/plugin-preferences-service";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/plugin-preferences/")({
	component: PluginPreferencesRoute,
});

function PluginPreferencesRoute() {
	const t = useT();
	const settings = useRyotQuery(pluginUserSettingsQuery);
	let content = (
		<StatusMessage tone="pending">
			{t(kernelMessage("client.route.settings.plugin-preferences.loading"))}
		</StatusMessage>
	);
	if (settings.data !== undefined) {
		content =
			settings.data.length === 0 ? (
				<p role="status" className="text-sm text-text-muted">
					{t(kernelMessage("client.route.settings.plugin-preferences.none"))}
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
					{settings.data
						.map((setting) => ({ setting, name: t(setting.name) }))
						.sort((left, right) => left.name.localeCompare(right.name))
						.map(({ name, setting }) => (
							<li key={setting.id}>
								<Link
									params={{ installationId: setting.id }}
									to="/settings/plugin-preferences/$installationId"
									className="flex min-h-14 items-center gap-3 px-4 text-sm text-text hover:bg-surface-2"
								>
									<AppIcon size={18} name={setting.icon} className="shrink-0 text-text-muted" />
									<span className="min-w-0 flex-1 truncate">{name}</span>
									<AppIcon size={15} name="chevron-right" className="text-text-subtle" />
								</Link>
							</li>
						))}
				</ul>
			);
	} else if (settings.isError) {
		content = (
			<StatusMessage tone="error">
				{t(kernelMessage("client.route.settings.plugin-preferences.load-failed"))}
			</StatusMessage>
		);
	}

	return (
		<SettingsFrame
			backFallbackHref="/settings"
			title={t(kernelMessage("client.settings.section.plugin-preferences"))}
		>
			{content}
		</SettingsFrame>
	);
}
