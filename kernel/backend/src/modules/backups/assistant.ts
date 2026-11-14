import {
	AssistantApprovalDecision,
	AssistantConversation,
	AssistantMessage,
	AssistantToolCall,
	AssistantTurn,
} from "@ryot-app/contract/modules/assistant/schemas";
import { DataRecordTimestamp } from "@ryot-app/contract/modules/imports/data-json";
import { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import { HttpUrl, strictStruct } from "@ryot-app/contract/schema/utils";
import { Result, Schema } from "effect";

import { parseHttpBaseUrl } from "#platform/config/http-base-url";

const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
export const ArchiveAssistantRecord = Schema.Union([
	strictStruct({
		kind: Schema.Literal("conversation"),
		...AssistantConversation.fields,
		revision: positiveInteger,
		nextSequence: positiveInteger,
		createdAt: DataRecordTimestamp,
		updatedAt: DataRecordTimestamp,
	}),
	strictStruct({
		kind: Schema.Literal("turn"),
		...AssistantTurn.fields,
		text: Schema.String,
		revision: positiveInteger,
		createdAt: DataRecordTimestamp,
		completedAt: Schema.NullOr(DataRecordTimestamp),
	}),
	strictStruct({
		id: Schema.String,
		turnId: Schema.String,
		call: AssistantToolCall,
		revision: positiveInteger,
		kind: Schema.Literal("call"),
		conversationId: Schema.String,
		createdAt: DataRecordTimestamp,
		result: Schema.NullOr(AgentToolResult),
		decidedAt: Schema.NullOr(DataRecordTimestamp),
		completedAt: Schema.NullOr(DataRecordTimestamp),
		decision: Schema.NullOr(AssistantApprovalDecision),
		round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	}),
	strictStruct({
		kind: Schema.Literal("message"),
		...AssistantMessage.fields,
		sequence: positiveInteger,
		createdAt: DataRecordTimestamp,
	}),
	strictStruct({
		id: Schema.String,
		text: Schema.String,
		turnId: Schema.String,
		conversationId: Schema.String,
		kind: Schema.Literal("output"),
		createdAt: DataRecordTimestamp,
	}),
	strictStruct({
		hasApiKey: Schema.Boolean,
		model: Schema.NonEmptyString,
		createdAt: DataRecordTimestamp,
		updatedAt: DataRecordTimestamp,
		id: Schema.Literal("provider"),
		kind: Schema.Literal("provider"),
		contextWindow: Schema.NullOr(positiveInteger),
		maxOutputTokens: Schema.NullOr(positiveInteger),
		baseUrl: HttpUrl.check(Schema.makeFilter((value) => Result.isSuccess(parseHttpBaseUrl(value)))),
	}),
]);
export type ArchiveAssistantRecord = typeof ArchiveAssistantRecord.Type;

const prefixes = {
	turn: "1",
	call: "2",
	output: "5",
	message: "3",
	provider: "4",
	conversation: "0",
} as const;
export const assistantArchiveId = (kind: ArchiveAssistantRecord["kind"], id: string) =>
	`${prefixes[kind]}:${id}`;

export const assistantReferences = (record: ArchiveAssistantRecord) => {
	const references: Array<{ id: string; namespace: string }> = [];
	const add = (kind: ArchiveAssistantRecord["kind"], id: string) =>
		references.push({ namespace: "assistant", id: assistantArchiveId(kind, id) });
	if (record.kind === "provider" || record.kind === "conversation") {
		return references;
	}
	if (record.kind !== "turn") {
		add("turn", record.turnId);
	}
	add("conversation", record.conversationId);
	if (record.kind === "output") {
		add("call", record.id);
	}
	if (
		record.kind === "call" &&
		record.result?.truncated === "retained" &&
		record.result.outputId !== record.id
	) {
		add("call", record.result.outputId);
	}
	if (record.kind === "call" && record.call.kind === "capability") {
		add("call", record.call.parentId);
	}
	if (record.kind === "message") {
		for (const part of record.parts) {
			if (part.kind === "tool-call") {
				add("call", part.call.id);
			}
			if (part.kind === "tool-result" || part.kind === "approval") {
				add("call", part.toolCallId);
			}
			if (part.kind === "tool-result" && part.result.truncated === "retained") {
				add("call", part.result.outputId);
			}
			if (part.kind === "page-preview") {
				references.push({ id: part.pageId, namespace: "page" });
			}
		}
	}
	return references;
};
