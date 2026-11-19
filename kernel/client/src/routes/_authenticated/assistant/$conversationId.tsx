import { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AssistantSprite } from "#/modules/assistant/sprite";
import { AssistantConversation } from "#/modules/assistant/thread";
import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { AppScreen } from "#/modules/shell/app-screen";

export const Route = createFileRoute("/_authenticated/assistant/$conversationId")({
	component: Conversation,
});

function Conversation() {
	const navigate = useNavigate();
	const { server, runtime } = Route.useRouteContext();
	const { conversationId } = Route.useParams();
	return (
		<AssistantConversation
			key={conversationId}
			onDeleted={() => void navigate({ to: "/assistant" })}
			onStartNew={() => void navigate({ to: "/assistant/new" })}
			conversationId={AssistantConversationId.make(conversationId)}
			disabled={useIsDemoSession(runtime.runSync(AuthService).session(server))}
			renderFrame={(parts) => (
				<AppScreen
					width="readable"
					dock={parts.dock}
					title={parts.title}
					actions={parts.actions}
					followEnd={parts.followEnd}
					backFallbackHref="/assistant"
					titleIcon={<AssistantSprite className="w-9" mood={parts.mood} />}
				>
					{parts.children}
				</AppScreen>
			)}
		/>
	);
}
