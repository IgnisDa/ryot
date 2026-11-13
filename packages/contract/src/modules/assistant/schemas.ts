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
export const AssistantLocalToolName = Schema.Literals(["read_result"]);
export type AssistantLocalToolName = typeof AssistantLocalToolName.Type;
export const AssistantToolName = Schema.Union([AgentToolName, AssistantLocalToolName]);
export type AssistantToolName = typeof AssistantToolName.Type;
export const AssistantToolCall = Schema.Union([
	strictStruct({
		arguments: JsonValue,
		tool: AssistantToolName,
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
export const AssistantReasoningField = Schema.Literals(["reasoning", "reasoning_content"]);
export type AssistantReasoningField = typeof AssistantReasoningField.Type;
export const AssistantMessagePart = Schema.Union([
	strictStruct({ text: Schema.String, kind: Schema.Literal("text") }),
	strictStruct({ call: AssistantToolCall, kind: Schema.Literal("tool-call") }),
	strictStruct({
		text: Schema.String,
		field: AssistantReasoningField,
		kind: Schema.Literal("reasoning"),
	}),
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
	strictStruct({ text: Schema.String, kind: Schema.Literal("instruction") }),
	strictStruct({
		summary: Schema.String,
		throughSequence: Schema.Int,
		kind: Schema.Literal("compaction"),
	}),
]);
export type AssistantMessagePart = typeof AssistantMessagePart.Type;
export const AssistantConversationStatus = Schema.Literals([
	"idle",
	"working",
	"awaiting-approval",
	"failed",
]);
export type AssistantConversationStatus = typeof AssistantConversationStatus.Type;
export const ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH = 60;
export const AssistantConversationTitle = Schema.Trim.check(
	Schema.isMinLength(1),
	Schema.isMaxLength(ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH),
);
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
		"request-limit",
		"tool-failed",
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
export const ASSISTANT_DEFAULT_MODEL_LIMITS = { contextWindow: 496_000, maxOutputTokens: 32_000 };
export const AssistantTokenCount = Schema.Int.check(Schema.isGreaterThan(0));
export const assistantModelLimitsValid = (limits: {
	readonly contextWindow: number;
	readonly maxOutputTokens: number;
}) => limits.maxOutputTokens < limits.contextWindow;
export const AssistantProviderMetadata = strictStruct({
	baseUrl: HttpUrl,
	hasApiKey: Schema.Boolean,
	model: Schema.NonEmptyString,
	contextWindow: AssistantTokenCount,
	maxOutputTokens: AssistantTokenCount,
	source: Schema.Literals(["instance", "user"]),
});
export const AssistantConversationResult = strictStruct({
	conversationId: AssistantConversationId,
});
export const RenameAssistantConversationBody = strictStruct({
	...AssistantConversationResult.fields,
	title: AssistantConversationTitle,
});
export const SubmitAssistantTurnBody = strictStruct({
	text: Schema.NonEmptyString,
	requestId: Schema.NonEmptyString,
	conversationId: Schema.optional(AssistantConversationId),
});
export const SubmitAssistantTurnResult = strictStruct({
	...AssistantConversationResult.fields,
	turnId: AssistantTurnId,
});
export const InterruptAssistantTurnBody = SubmitAssistantTurnResult;
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
	contextWindow: Schema.optional(AssistantTokenCount),
	maxOutputTokens: Schema.optional(AssistantTokenCount),
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
export type InterruptAssistantTurnBody = typeof InterruptAssistantTurnBody.Type;
export type AssistantConversationResult = typeof AssistantConversationResult.Type;
export type DecideAssistantToolCallBody = typeof DecideAssistantToolCallBody.Type;
export type ConfigureAssistantProviderBody = typeof ConfigureAssistantProviderBody.Type;
export type RenameAssistantConversationBody = typeof RenameAssistantConversationBody.Type;
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
