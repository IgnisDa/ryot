import { createFileRoute } from "@tanstack/react-router";

import { ASSISTANT_NAME } from "#/modules/assistant/presentation";
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
		<SettingsFrame title={ASSISTANT_NAME} backFallbackHref="/settings">
			<AssistantProviderForm disabled={disabled} />
		</SettingsFrame>
	);
}
