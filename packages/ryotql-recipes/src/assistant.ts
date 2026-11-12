import {
	AssistantApprovalDecision,
	AssistantMessagePart,
	AssistantToolCall,
	AssistantTurnFailure,
	AssistantTurnStatus,
} from "@ryot-app/contract/modules/assistant/schemas";
import {
	AssistantConversationId,
	AssistantMessageId,
	AssistantToolCallId,
	AssistantTurnId,
} from "@ryot-app/contract/schema/brands";
import { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import {
	ascending,
	column,
	defineRecipe,
	descending,
	eq,
	type Recipe,
	selectedField,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const conversation = table("assistantConversation", "conversation");
const message = table("assistantMessage", "message");
const turn = table("assistantTurn", "turn");
const call = table("assistantToolCall", "call");
const metadata = {
	title: selectedField(column(conversation, "title"), Schema.String),
	revision: selectedField(column(conversation, "revision"), Schema.Int),
	id: selectedField(column(conversation, "id"), AssistantConversationId),
	createdAt: selectedField(column(conversation, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(conversation, "updatedAt"), IsoDateString),
};
export const assistantConversationsRecipe = defineRecipe({
	map: ({ conversations }) => Result.succeed(conversations),
	queries: {
		conversations: selectedRows(conversation, {
			limit: 20,
			maxLimit: 100,
			selection: metadata,
			orderBy: [
				descending(column(conversation, "updatedAt")),
				ascending(column(conversation, "id")),
			],
		}),
	},
});
const detail = parameters({
	fields: {
		conversationId: {
			type: "string",
			label: "Conversation",
			description: "Conversation ID",
			validation: { required: true },
		},
	},
});
export const assistantConversationRecipe = defineRecipe({
	parameters: detail.schema,
	queries: {
		conversation: selectedOptionalRow(conversation, {
			selection: metadata,
			orderBy: [ascending(column(conversation, "id"))],
			where: eq(column(conversation, "id"), detail.value("conversationId")),
		}),
		messages: selectedRows(message, {
			limit: 100,
			maxLimit: 100,
			where: eq(column(message, "conversationId"), detail.value("conversationId")),
			orderBy: [ascending(column(message, "sequence")), ascending(column(message, "id"))],
			selection: {
				id: selectedField(column(message, "id"), AssistantMessageId),
				sequence: selectedField(column(message, "sequence"), Schema.Int),
				turnId: selectedField(column(message, "turnId"), AssistantTurnId),
				createdAt: selectedField(column(message, "createdAt"), IsoDateString),
				parts: selectedField(column(message, "parts"), Schema.Array(AssistantMessagePart)),
				role: selectedField(
					column(message, "role"),
					Schema.Literals(["user", "assistant", "tool"]),
				),
			},
		}),
		calls: selectedRows(call, {
			limit: 100,
			maxLimit: 100,
			where: eq(column(call, "conversationId"), detail.value("conversationId")),
			orderBy: [
				ascending(column(call, "createdAt")),
				ascending(column(call, "round")),
				ascending(column(call, "position")),
				ascending(column(call, "id")),
			],
			selection: {
				id: selectedField(column(call, "id"), AssistantToolCallId),
				call: selectedField(column(call, "call"), AssistantToolCall),
				revision: selectedField(column(call, "revision"), Schema.Int),
				turnId: selectedField(column(call, "turnId"), AssistantTurnId),
				result: selectedField(column(call, "result"), Schema.NullOr(AgentToolResult)),
				decision: selectedField(column(call, "decision"), Schema.NullOr(AssistantApprovalDecision)),
			},
		}),
		turns: selectedRows(turn, {
			limit: 100,
			maxLimit: 100,
			where: eq(column(turn, "conversationId"), detail.value("conversationId")),
			orderBy: [ascending(column(turn, "createdAt")), ascending(column(turn, "id"))],
			selection: {
				id: selectedField(column(turn, "id"), AssistantTurnId),
				round: selectedField(column(turn, "round"), Schema.Int),
				revision: selectedField(column(turn, "revision"), Schema.Int),
				requestId: selectedField(column(turn, "requestId"), Schema.String),
				status: selectedField(column(turn, "status"), AssistantTurnStatus),
				createdAt: selectedField(column(turn, "createdAt"), IsoDateString),
				failure: selectedField(column(turn, "failure"), Schema.NullOr(AssistantTurnFailure)),
				completedAt: selectedField(column(turn, "completedAt"), Schema.NullOr(IsoDateString)),
			},
		}),
	},
});
export type AssistantConversationList = Recipe.Success<typeof assistantConversationsRecipe>;
export type AssistantConversationDetail = Recipe.Success<typeof assistantConversationRecipe>;
