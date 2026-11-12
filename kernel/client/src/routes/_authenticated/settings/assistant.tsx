import { createFileRoute } from "@tanstack/react-router";

import { AssistantProviderForm } from "#/modules/assistant/provider";
import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { SettingsFrame } from "#/modules/settings/settings-frame";

export const Route = createFileRoute("/_authenticated/settings/assistant")({
	component: AssistantSettings,
});
function AssistantSettings() {
	const { server, runtime } = Route.useRouteContext();
	const disabled = useIsDemoSession(runtime.runSync(AuthService).session(server));
	return (
		<SettingsFrame title="Ryobot" backFallbackHref="/settings">
			<AssistantProviderForm disabled={disabled} />
		</SettingsFrame>
	);
}
