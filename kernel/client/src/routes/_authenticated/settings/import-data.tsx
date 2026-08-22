import { StatusMessage } from "@ryot-app/client-ui-sdk";
import { createFileRoute } from "@tanstack/react-router";

import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/import-data")({
	component: ImportDataRoute,
});

function ImportDataRoute() {
	return (
		<SettingsFrame title="Import data" backFallbackHref="/settings">
			<StatusMessage tone="pending">
				Importing a one-off history is not available here yet.
			</StatusMessage>
		</SettingsFrame>
	);
}
