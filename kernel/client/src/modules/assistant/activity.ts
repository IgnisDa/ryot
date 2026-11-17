import type { AssistantConversationId } from "@ryot-app/contract/schema/brands";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
	readonly t: (message: Message) => Text;
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
			id: `assistant:${conversation.id}`,
			onDismiss: () => options.onDismiss(conversation.id),
			title: formatDisplayText(options.t, conversation.title),
			action: {
				onClick: () => options.onReview(conversation.id),
				label: options.t(kernelMessage("client.assistant.activity.review")),
			},
			status: options.t(
				conversation.status === "awaiting-input"
					? kernelMessage("client.assistant.activity.needs-answer")
					: kernelMessage("client.assistant.activity.needs-approval"),
			),
		}));
