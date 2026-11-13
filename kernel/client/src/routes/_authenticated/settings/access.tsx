import { createFileRoute } from "@tanstack/react-router";

import { AccessManager } from "#/modules/access/manager";
import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/access")({ component: AccessRoute });

function AccessRoute() {
	const { server, runtime } = Route.useRouteContext();
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	return (
		<SettingsFrame title="Access" backFallbackHref="/settings">
			<AccessManager isDemo={isDemo} />
		</SettingsFrame>
	);
}
