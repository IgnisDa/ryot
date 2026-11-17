import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

import type { ServerOrigin } from "#/api/origin";
import { SettingsSection } from "#/modules/settings/settings-section";

export function AboutServer(props: { readonly server: ServerOrigin }) {
	const t = useT();
	return (
		<SettingsSection
			title={t(kernelMessage("client.settings.about.server.title"))}
			detail={t(kernelMessage("client.settings.about.server.detail"))}
		>
			<div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
				<p className="truncate text-sm font-medium text-text">{props.server}</p>
				<p className="text-xs leading-4 text-text-muted">
					{t(kernelMessage("client.settings.about.server.note"))}
				</p>
			</div>
		</SettingsSection>
	);
}
