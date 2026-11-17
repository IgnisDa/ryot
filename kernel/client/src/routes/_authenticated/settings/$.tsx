import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { createFileRoute } from "@tanstack/react-router";

import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/$")({ component: SettingsNotFound });

function SettingsNotFound() {
	const t = useT();
	return (
		<SettingsFrame
			backFallbackHref="/settings"
			title={t(kernelMessage("client.route.settings.not-found.title"))}
		>
			<p role="status" className="text-text-muted">
				{t(kernelMessage("client.route.page-not-found.detail"))}
			</p>
		</SettingsFrame>
	);
}
