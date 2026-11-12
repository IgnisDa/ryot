import { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AssistantConversations } from "#/modules/assistant/conversation";
import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { useClearClientPageDocument } from "#/modules/pages/documents/state";
import { AppScreen } from "#/modules/shell/app-screen";

export const Route = createFileRoute("/_authenticated/assistant")({
	component: AssistantRoute,
	validateSearch: (search) => ({
		conversationId: typeof search.conversationId === "string" ? search.conversationId : undefined,
	}),
});
function AssistantRoute() {
	const { server, runtime } = Route.useRouteContext();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const disabled = useIsDemoSession(runtime.runSync(AuthService).session(server));
	useClearClientPageDocument();
	return (
		<AppScreen title="Ryobot">
			<AssistantConversations
				disabled={disabled}
				selected={
					search.conversationId === undefined
						? null
						: AssistantConversationId.make(search.conversationId)
				}
				onSelect={(id) =>
					void navigate({
						href:
							id === null ? "/assistant" : `/assistant?conversationId=${encodeURIComponent(id)}`,
					})
				}
			/>
		</AppScreen>
	);
}
