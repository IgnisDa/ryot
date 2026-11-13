import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import type { ActivityTrayEntry } from "@ryot-app/plugin-ui-sdk";

import { ASSISTANT_NAME } from "./presentation";
import { activityQuery } from "./service";
import type { AssistantMood } from "./sprite";

export const useAssistantActivity = () => {
	const conversations = useRyotQuery(activityQuery, { arguments: {} }).data?.items ?? [];
	const attention = conversations.filter(
		({ status }) => status === "awaiting-approval" || status === "awaiting-input",
	);
	let mood: AssistantMood = "idle";
	if (attention.length > 0) {
		mood = "waiting";
	} else if (conversations.length > 0) {
		mood = "working";
	}
	return { mood, attention };
};

export const assistantAttentionEntries = (options: {
	readonly dismissed: ReadonlySet<string>;
	readonly activeConversationId: null | string;
	readonly onDismiss: (conversationId: string) => void;
	readonly onReview: (conversationId: AssistantConversationId) => void;
	readonly conversations: ReturnType<typeof useAssistantActivity>["attention"];
}): ActivityTrayEntry[] =>
	options.conversations
		.filter(
			(conversation) =>
				conversation.id !== options.activeConversationId && !options.dismissed.has(conversation.id),
		)
		.map((conversation) => ({
			tone: "warning",
			source: ASSISTANT_NAME,
			title: conversation.title,
			status: conversation.status === "awaiting-input" ? "Needs your answer" : "Needs your approval",
			id: `assistant:${conversation.id}`,
			onDismiss: () => options.onDismiss(conversation.id),
			action: { label: "Review", onClick: () => options.onReview(conversation.id) },
		}));
