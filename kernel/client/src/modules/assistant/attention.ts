import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { ActivityTrayEntry } from "@ryot-app/plugin-ui-sdk";

import { awaitingApprovalQuery } from "./service";

export const useAssistantAttention = () =>
	useRyotQuery(awaitingApprovalQuery, { arguments: {} }).data?.items ?? [];

export const assistantAttentionEntries = (options: {
	readonly dismissed: ReadonlySet<string>;
	readonly activeConversationId: string | undefined;
	readonly onReview: (conversationId: string) => void;
	readonly onDismiss: (conversationId: string) => void;
	readonly conversations: ReturnType<typeof useAssistantAttention>;
}): ActivityTrayEntry[] =>
	options.conversations
		.filter(
			(conversation) =>
				conversation.id !== options.activeConversationId && !options.dismissed.has(conversation.id),
		)
		.map((conversation) => ({
			tone: "warning",
			source: "Ryobot",
			title: conversation.title,
			status: "Needs your approval",
			id: `assistant:${conversation.id}`,
			onDismiss: () => options.onDismiss(conversation.id),
			action: { label: "Review", onClick: () => options.onReview(conversation.id) },
		}));
