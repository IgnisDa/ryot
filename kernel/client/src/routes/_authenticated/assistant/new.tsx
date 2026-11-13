import { createFileRoute } from "@tanstack/react-router";

import { AssistantStart } from "#/modules/assistant/start";
import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";

export const Route = createFileRoute("/_authenticated/assistant/new")({ component: NewChat });

function NewChat() {
	const { server, runtime } = Route.useRouteContext();
	return (
		<AssistantStart disabled={useIsDemoSession(runtime.runSync(AuthService).session(server))} />
	);
}
