import { Schema } from "effect";

import { AgentToolName } from "../../schema/agent-tool";
import {
	AssistantConversationId,
	AssistantMessageId,
	AssistantToolCallId,
	AssistantTurnId,
	SavedViewId,
} from "../../schema/brands";
import { Capability } from "../../schema/capability";
import { JsonValue } from "../../schema/json";
import { AgentToolResult } from "../../schema/tool-result";
import { HttpUrl, strictStruct } from "../../schema/utils";
import { PageDraftBuildIdentity } from "../pages/identity";

export const AssistantTurnStatus = Schema.Literals([
	"queued",
	"running",
	"awaiting-approval",
	"completed",
	"failed",
	"interrupted",
]);
export type AssistantTurnStatus = typeof AssistantTurnStatus.Type;
export const AssistantApprovalDecision = Schema.Literals(["approve", "decline"]);
export type AssistantApprovalDecision = typeof AssistantApprovalDecision.Type;
export const AssistantToolCall = Schema.Union([
	strictStruct({
		tool: AgentToolName,
		arguments: JsonValue,
		id: AssistantToolCallId,
		kind: Schema.Literal("tool"),
		requiresApproval: Schema.Boolean,
		modelCallId: Schema.NonEmptyString,
	}),
	strictStruct({
		arguments: JsonValue,
		capability: Capability,
		id: AssistantToolCallId,
		parentId: AssistantToolCallId,
		requiresApproval: Schema.Boolean,
		kind: Schema.Literal("capability"),
		hostCallIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	}),
]);
export type AssistantToolCall = typeof AssistantToolCall.Type;
export const AssistantMessagePart = Schema.Union([
	strictStruct({ text: Schema.String, kind: Schema.Literal("text") }),
	strictStruct({ call: AssistantToolCall, kind: Schema.Literal("tool-call") }),
	strictStruct({
		result: AgentToolResult,
		toolCallId: AssistantToolCallId,
		kind: Schema.Literal("tool-result"),
	}),
	strictStruct({
		revision: Schema.Int,
		toolCallId: AssistantToolCallId,
		kind: Schema.Literal("approval"),
		decision: AssistantApprovalDecision,
	}),
	strictStruct({ kind: Schema.Literal("page-preview"), ...PageDraftBuildIdentity.fields }),
]);
export type AssistantMessagePart = typeof AssistantMessagePart.Type;
export const AssistantConversation = strictStruct({
	title: Schema.String,
	revision: Schema.Int,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	id: AssistantConversationId,
});
export const AssistantMessage = strictStruct({
	sequence: Schema.Int,
	id: AssistantMessageId,
	turnId: AssistantTurnId,
	createdAt: Schema.String,
	conversationId: AssistantConversationId,
	parts: Schema.Array(AssistantMessagePart),
	role: Schema.Literals(["user", "assistant", "tool"]),
});
export const AssistantTurnFailure = strictStruct({
	code: Schema.Literals([
		"provider-unavailable",
		"provider-failed",
		"tool-failed",
		"round-limit",
		"execution-failed",
	]),
});
export type AssistantTurnFailure = typeof AssistantTurnFailure.Type;
export const AssistantTurn = strictStruct({
	round: Schema.Int,
	id: AssistantTurnId,
	revision: Schema.Int,
	requestId: Schema.String,
	createdAt: Schema.String,
	status: AssistantTurnStatus,
	conversationId: AssistantConversationId,
	completedAt: Schema.NullOr(Schema.String),
	failure: Schema.NullOr(AssistantTurnFailure),
});
export const AssistantProviderMetadata = strictStruct({
	baseUrl: HttpUrl,
	hasApiKey: Schema.Boolean,
	model: Schema.NonEmptyString,
	source: Schema.Literals(["instance", "user"]),
});
export const CreateAssistantConversationBody = strictStruct({ title: Schema.NonEmptyString });
export const AssistantConversationResult = strictStruct({
	conversationId: AssistantConversationId,
});
export const SubmitAssistantTurnBody = strictStruct({
	...AssistantConversationResult.fields,
	text: Schema.NonEmptyString,
	requestId: Schema.NonEmptyString,
});
export const SubmitAssistantTurnResult = strictStruct({
	...AssistantConversationResult.fields,
	turnId: AssistantTurnId,
});
export const DecideAssistantToolCallBody = strictStruct({
	...SubmitAssistantTurnResult.fields,
	toolCallId: AssistantToolCallId,
	decision: AssistantApprovalDecision,
	expectedRevision: Schema.Int.check(Schema.isGreaterThan(0)),
});
export const ConfigureAssistantProviderBody = strictStruct({
	baseUrl: HttpUrl,
	model: Schema.NonEmptyString,
	apiKey: Schema.optional(Schema.NonEmptyString),
});
export const SaveAssistantPageBody = strictStruct({
	...SubmitAssistantTurnResult.fields,
	requestId: Schema.NonEmptyString,
	...PageDraftBuildIdentity.fields,
	name: Schema.NonEmptyString,
	slug: Schema.NonEmptyString,
	icon: Schema.NonEmptyString,
});
export const SaveAssistantPageResult = strictStruct({
	pageId: Schema.String,
	savedViewId: SavedViewId,
});
export type AssistantTurn = typeof AssistantTurn.Type;

export type AssistantMessage = typeof AssistantMessage.Type;
export type AssistantConversation = typeof AssistantConversation.Type;
export type SaveAssistantPageBody = typeof SaveAssistantPageBody.Type;
export type SubmitAssistantTurnBody = typeof SubmitAssistantTurnBody.Type;
export type SaveAssistantPageResult = typeof SaveAssistantPageResult.Type;
export type AssistantProviderMetadata = typeof AssistantProviderMetadata.Type;
export type SubmitAssistantTurnResult = typeof SubmitAssistantTurnResult.Type;
export type AssistantConversationResult = typeof AssistantConversationResult.Type;
export type DecideAssistantToolCallBody = typeof DecideAssistantToolCallBody.Type;
export type ConfigureAssistantProviderBody = typeof ConfigureAssistantProviderBody.Type;
export type CreateAssistantConversationBody = typeof CreateAssistantConversationBody.Type;
export class AssistantError extends Schema.TaggedError<
	AssistantError,
	{ readonly brand: unique symbol }
>()("AssistantError", {
	reason: strictStruct({
		code: Schema.Literals([
			"conversation-not-found",
			"turn-not-found",
			"conversation-active",
			"request-conflict",
			"revision-stale",
			"tool-call-not-found",
			"decision-conflict",
			"turn-not-active",
			"provider-unavailable",
			"page-preview-not-found",
			"provider-invalid",
			"page-save-failed",
		]),
	}),
}) {}
