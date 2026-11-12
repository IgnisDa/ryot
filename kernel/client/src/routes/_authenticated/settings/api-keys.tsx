import { createFileRoute } from "@tanstack/react-router";

import { ApiKeysManager } from "#/modules/api-keys/manager";
import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/api-keys")({
	component: ApiKeysRoute,
});

function ApiKeysRoute() {
	const { server, runtime } = Route.useRouteContext();
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	return (
		<SettingsFrame title="API keys" backFallbackHref="/settings">
			<ApiKeysManager isDemo={isDemo} />
		</SettingsFrame>
	);
}
