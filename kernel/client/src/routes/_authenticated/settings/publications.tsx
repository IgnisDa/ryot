import { createFileRoute } from "@tanstack/react-router";

import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { PublicationsManager } from "#/modules/publications/manager";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/publications")({
	component: PublicationsRoute,
});

function PublicationsRoute() {
	const { server, runtime } = Route.useRouteContext();
	const disabled = useIsDemoSession(runtime.runSync(AuthService).session(server));
	return (
		<SettingsFrame title="Publications" backFallbackHref="/settings">
			<PublicationsManager serverUrl={server} disabled={disabled} />
		</SettingsFrame>
	);
}
