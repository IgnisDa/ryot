import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AssistantConversationList } from "#/modules/assistant/conversation-list";
import { AssistantStart } from "#/modules/assistant/start";
import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import { AppScreen } from "#/modules/shell/app-screen";
import { useEdge } from "#/modules/shell/authenticated-shell-context";

export const Route = createFileRoute("/_authenticated/assistant/")({ component: AssistantHome });

function AssistantHome() {
	const { server, runtime } = Route.useRouteContext();
	const disabled = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const edge = useEdge();
	const navigate = useNavigate();
	if (!edge.compact) {
		return <AssistantStart disabled={disabled} />;
	}
	return (
		<AppScreen
			title="Ryobot"
			barActions={
				<Button size="sm" variant="ghost" onClick={() => void navigate({ to: "/assistant/new" })}>
					<AppIcon size={14} name="plus" />
					New chat
				</Button>
			}
		>
			<AssistantConversationList compact activeId={null} />
		</AppScreen>
	);
}
