import { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { createFileRoute } from "@tanstack/react-router";

import { AssistantThread } from "#/modules/assistant/thread";
import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";

export const Route = createFileRoute("/_authenticated/assistant/$conversationId")({
	component: Conversation,
});

function Conversation() {
	const { server, runtime } = Route.useRouteContext();
	const { conversationId } = Route.useParams();
	const disabled = useIsDemoSession(runtime.runSync(AuthService).session(server));
	return (
		<AssistantThread
			disabled={disabled}
			key={conversationId}
			conversationId={AssistantConversationId.make(conversationId)}
		/>
	);
}
