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
		hasApiKey: Schema.Boolean,
		model: Schema.NonEmptyString,
		createdAt: DataRecordTimestamp,
		updatedAt: DataRecordTimestamp,
		id: Schema.Literal("provider"),
		kind: Schema.Literal("provider"),
		baseUrl: HttpUrl.check(Schema.makeFilter((value) => Result.isSuccess(parseHttpBaseUrl(value)))),
	}),
]);
export type ArchiveAssistantRecord = typeof ArchiveAssistantRecord.Type;

const prefixes = { turn: "1", call: "2", message: "3", provider: "4", conversation: "0" } as const;
export const assistantArchiveId = (kind: ArchiveAssistantRecord["kind"], id: string) =>
	`${prefixes[kind]}:${id}`;

export const assistantReferences = (record: ArchiveAssistantRecord) => {
	const references: Array<{ id: string; namespace: string }> = [];
	const add = (kind: ArchiveAssistantRecord["kind"], id: string) =>
		references.push({ namespace: "assistant", id: assistantArchiveId(kind, id) });
	if (record.kind === "turn" || record.kind === "message" || record.kind === "call") {
		add("conversation", record.conversationId);
	}
	if (record.kind === "message" || record.kind === "call") {
		add("turn", record.turnId);
	}
	if (record.kind === "message") {
		for (const part of record.parts) {
			if (part.kind === "tool-call") {
				add("call", part.call.id);
			}
			if (part.kind === "tool-result" || part.kind === "approval") {
				add("call", part.toolCallId);
			}
			if (part.kind === "page-preview") {
				references.push({ id: part.pageId, namespace: "page" });
			}
		}
	}
	return references;
};
