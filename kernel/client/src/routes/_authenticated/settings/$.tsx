import { createFileRoute } from "@tanstack/react-router";

import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/$")({
	component: SettingsNotFound,
});

function SettingsNotFound() {
	return (
		<SettingsFrame title="Not found" backFallbackHref="/settings">
			<p role="status" className="text-text-muted">
				This page does not exist.
			</p>
		</SettingsFrame>
	);
}
