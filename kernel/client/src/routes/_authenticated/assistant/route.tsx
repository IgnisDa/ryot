import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { createFileRoute, Outlet, useNavigate, useParams } from "@tanstack/react-router";

import { AssistantConversationList } from "#/modules/assistant/conversation-list";
import { ASSISTANT_NAME } from "#/modules/assistant/presentation";
import { useClearClientPageDocument } from "#/modules/pages/documents/state";
import { useEdge } from "#/modules/shell/authenticated-shell-context";

export const Route = createFileRoute("/_authenticated/assistant")({ component: AssistantLayout });

function AssistantLayout() {
	const t = useT();
	const edge = useEdge();
	const navigate = useNavigate();
	const { conversationId } = useParams({ strict: false });
	useClearClientPageDocument();
	if (edge.compact) {
		return <Outlet />;
	}
	return (
		<div className="flex h-full min-h-0">
			<aside
				className="flex w-72 shrink-0 flex-col border-r border-border"
				aria-label={t(
					kernelMessage("client.route.assistant.conversations", { name: ASSISTANT_NAME }),
				)}
			>
				<div className="flex items-center justify-between gap-2 px-4 pt-6 pb-3">
					<h2 className="font-display text-heading font-semibold text-text">{ASSISTANT_NAME}</h2>
					<Button
						size="sm"
						variant="outline"
						onClick={() => void navigate({ to: "/assistant/new" })}
					>
						<AppIcon size={14} name="plus" />
						{t(kernelMessage("client.assistant.new-chat"))}
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
					<AssistantConversationList compact={false} activeId={conversationId ?? null} />
				</div>
			</aside>
			<div className="min-w-0 flex-1">
				<Outlet />
			</div>
		</div>
	);
}
