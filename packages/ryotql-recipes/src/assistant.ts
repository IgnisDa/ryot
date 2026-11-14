import {
	AssistantApprovalDecision,
	AssistantConversationStatus,
	AssistantMessagePart,
	AssistantQuestionInput,
	AssistantTodoInput,
	AssistantToolCall,
	type AssistantToolName,
	AssistantTurnFailure,
	AssistantTurnStatus,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { PageDraftBuildIdentity } from "@ryot-app/contract/modules/pages/identity";
import {
	AssistantConversationId,
	AssistantMessageId,
	AssistantToolCallId,
	AssistantTurnId,
} from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import {
	and,
	ascending,
	column,
	defineRecipe,
	descending,
	eq,
	inArray,
	isNull,
	literal,
	type Recipe,
	selectedField,
	selectedInclude,
	selectedOptionalRow,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";

const conversation = table("assistantConversation", "conversation");
const message = table("assistantMessage", "message");
const turn = table("assistantTurn", "turn");
const call = table("assistantToolCall", "call");
const inbox = table("assistantInbox", "inbox");
const conversationSelection = {
	title: selectedField(column(conversation, "title"), Schema.String),
	revision: selectedField(column(conversation, "revision"), Schema.Int),
	id: selectedField(column(conversation, "id"), AssistantConversationId),
	createdAt: selectedField(column(conversation, "createdAt"), IsoDateString),
	updatedAt: selectedField(column(conversation, "updatedAt"), IsoDateString),
	status: selectedField(column(conversation, "status"), AssistantConversationStatus),
};
const recentConversations = [
	descending(column(conversation, "updatedAt")),
	ascending(column(conversation, "id")),
] as const;

export const assistantConversationsRecipe = defineRecipe({
	map: ({ conversations }) => Result.succeed(conversations),
	queries: {
		conversations: selectedRows(conversation, {
			limit: 20,
			maxLimit: 100,
			selection: conversationSelection,
			orderBy: [...recentConversations],
		}),
	},
});

export const assistantActivityRecipe = defineRecipe({
	map: ({ conversations }) => Result.succeed(conversations),
	queries: {
		conversations: selectedRows(conversation, {
			limit: 20,
			maxLimit: 20,
			orderBy: [...recentConversations],
			selection: {
				id: conversationSelection.id,
				title: conversationSelection.title,
				status: conversationSelection.status,
			},
			where: inArray(column(conversation, "status"), [
				literal("working"),
				literal("awaiting-approval"),
				literal("awaiting-input"),
			]),
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
			selection: conversationSelection,
			orderBy: [ascending(column(conversation, "id"))],
			where: eq(column(conversation, "id"), detail.value("conversationId")),
		}),
		turns: selectedRows(turn, {
			limit: 10,
			maxLimit: 10,
			where: eq(column(turn, "conversationId"), detail.value("conversationId")),
			orderBy: [descending(column(turn, "createdAt")), descending(column(turn, "id"))],
			selection: {
				id: selectedField(column(turn, "id"), AssistantTurnId),
				round: selectedField(column(turn, "round"), Schema.Int),
				text: selectedField(column(turn, "text"), Schema.String),
				revision: selectedField(column(turn, "revision"), Schema.Int),
				requestId: selectedField(column(turn, "requestId"), Schema.String),
				status: selectedField(column(turn, "status"), AssistantTurnStatus),
				createdAt: selectedField(column(turn, "createdAt"), IsoDateString),
				failure: selectedField(column(turn, "failure"), Schema.NullOr(AssistantTurnFailure)),
				completedAt: selectedField(column(turn, "completedAt"), Schema.NullOr(IsoDateString)),
			},
			include: {
				queued: selectedInclude(inbox, {
					limit: 20,
					orderBy: [ascending(column(inbox, "createdAt")), ascending(column(inbox, "id"))],
					where: and(
						eq(column(inbox, "turnId"), column(turn, "id")),
						isNull(column(inbox, "deliveredAt")),
					),
					selection: {
						id: selectedField(column(inbox, "id"), Schema.String),
						text: selectedField(column(inbox, "text"), Schema.String),
					},
				}),
				messages: selectedInclude(message, {
					limit: 100,
					where: eq(column(message, "turnId"), column(turn, "id")),
					orderBy: [ascending(column(message, "sequence")), ascending(column(message, "id"))],
					selection: {
						id: selectedField(column(message, "id"), AssistantMessageId),
						sequence: selectedField(column(message, "sequence"), Schema.Int),
						parts: selectedField(column(message, "parts"), Schema.Array(AssistantMessagePart)),
						role: selectedField(
							column(message, "role"),
							Schema.Literals(["user", "assistant", "tool"]),
						),
					},
				}),
				calls: selectedInclude(call, {
					limit: 100,
					where: eq(column(call, "turnId"), column(turn, "id")),
					orderBy: [
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
						decision: selectedField(
							column(call, "decision"),
							Schema.NullOr(AssistantApprovalDecision),
						),
					},
				}),
			},
		}),
	},
});
export type AssistantCallRecord = AssistantTurnRecord["calls"]["items"][number];
export type AssistantApprovalState = "pending" | "expired" | "approved" | "declined";
export type AssistantTurnRecord = AssistantConversationDetail["turns"]["items"][number];
export type AssistantConversationList = Recipe.Success<typeof assistantConversationsRecipe>;

export type AssistantConversationDetail = Recipe.Success<typeof assistantConversationRecipe>;
export type AssistantStepStatus = "done" | "failed" | "running" | "declined" | "interrupted";
export type AssistantTranscriptStep =
	| { readonly id: string; readonly text: string; readonly kind: "reasoning" }
	| {
			readonly id: string;
			readonly kind: "tool";
			readonly arguments: JsonValue;
			readonly tool: AssistantToolName;
			readonly status: AssistantStepStatus;
	  };
export type AssistantTranscriptTurn = {
	readonly prompt: string;
	readonly partial: boolean;
	readonly createdAt: string;
	readonly completedAt: null | string;
	readonly id: AssistantTurnRecord["id"];
	readonly status: AssistantTurnRecord["status"];
	readonly failure: AssistantTurnRecord["failure"];
	readonly entries: readonly AssistantTranscriptEntry[];
	readonly queued: readonly { readonly id: string; readonly text: string }[];
};
export type AssistantTranscriptEntry =
	| { readonly id: string; readonly kind: "compaction" }
	| { readonly id: string; readonly text: string; readonly kind: "steer" }
	| { readonly id: string; readonly text: string; readonly kind: "reply" }
	| { readonly id: string; readonly kind: "todo"; readonly items: AssistantTodoInput["items"] }
	| {
			readonly id: string;
			readonly kind: "page-preview";
			readonly identity: PageDraftBuildIdentity;
	  }
	| {
			readonly id: string;
			readonly kind: "steps";
			readonly steps: readonly AssistantTranscriptStep[];
	  }
	| {
			readonly id: string;
			readonly kind: "approval";
			readonly call: AssistantCallRecord;
			readonly state: AssistantApprovalState;
	  }
	| {
			readonly id: string;
			readonly kind: "question";
			readonly call: AssistantCallRecord;
			readonly answers: null | readonly string[];
			readonly state: "pending" | "expired" | "answered";
			readonly questions: AssistantQuestionInput["questions"];
	  };

const activeTurnStatuses: ReadonlySet<AssistantTurnRecord["status"]> = new Set([
	"queued",
	"running",
	"awaiting-input",
	"awaiting-approval",
]);
export const isActiveAssistantTurn = (status: AssistantTurnRecord["status"]) =>
	activeTurnStatuses.has(status);

const resultValue = (result: AgentToolResult) =>
	!result.truncated && isObjectRecord(result.value) ? result.value : null;

const QuestionAnswers = Schema.Struct({
	answers: Schema.Array(Schema.Struct({ answer: Schema.String })),
});

const stepStatus = (record: AssistantCallRecord, active: boolean): AssistantStepStatus => {
	if (record.result === null) {
		return active ? "running" : "interrupted";
	}
	const value = resultValue(record.result);
	if (value?.["interrupted"] === true) {
		return "interrupted";
	}
	if (value?.["declined"] === true) {
		return "declined";
	}
	return typeof value?.["error"] === "string" ? "failed" : "done";
};

const approvalState = (
	record: AssistantCallRecord,
	status: AssistantTurnRecord["status"],
): AssistantApprovalState => {
	if (record.decision === "approve") {
		return "approved";
	}
	if (record.decision === "decline") {
		return "declined";
	}
	return record.result === null && status === "awaiting-approval" ? "pending" : "expired";
};

export const projectAssistantTurn = (record: AssistantTurnRecord): AssistantTranscriptTurn => {
	const active = isActiveAssistantTurn(record.status);
	const calls = new Map(record.calls.items.map((item) => [item.id, item]));
	const latestTodo = record.messages.items
		.flatMap((item) =>
			item.parts.flatMap((part) =>
				part.kind === "tool-call" && part.call.kind === "tool" && part.call.tool === "todo"
					? [part.call.id]
					: [],
			),
		)
		.at(-1);
	const entries: AssistantTranscriptEntry[] = [];
	let steps: AssistantTranscriptStep[] = [];
	const closeSteps = () => {
		const first = steps[0];
		if (first !== undefined) {
			entries.push({ steps, kind: "steps", id: `steps:${first.id}` });
			steps = [];
		}
	};
	const pushApproval = (item: AssistantCallRecord) => {
		closeSteps();
		entries.push({
			call: item,
			id: item.id,
			kind: "approval",
			state: approvalState(item, record.status),
		});
	};
	let prompted = false;
	for (const item of record.messages.items) {
		if (item.role === "user") {
			for (const [index, part] of item.parts.entries()) {
				if (part.kind === "text") {
					if (prompted) {
						closeSteps();
						entries.push({ kind: "steer", text: part.text, id: `${item.id}:${index}` });
					}
					prompted = true;
				}
			}
			continue;
		}
		item.parts.forEach((part, index) => {
			const id = `${item.id}:${index}`;
			if (part.kind === "text" && part.text.trim() !== "") {
				closeSteps();
				entries.push({ id, kind: "reply", text: part.text });
			} else if (part.kind === "reasoning" && part.text.trim() !== "") {
				steps.push({ id, text: part.text, kind: "reasoning" });
			} else if (part.kind === "compaction") {
				closeSteps();
				entries.push({ id, kind: "compaction" });
			} else if (part.kind === "page-preview") {
				const { kind: _kind, ...identity } = part;
				closeSteps();
				entries.push({ id, identity, kind: "page-preview" });
			} else if (part.kind === "tool-call") {
				const stored = calls.get(part.call.id);
				if (stored === undefined || part.call.kind !== "tool") {
					return;
				}
				const { tool, arguments: input } = part.call;
				if (tool === "todo" && Schema.is(AssistantTodoInput)(input)) {
					if (stored.id === latestTodo) {
						closeSteps();
						entries.push({ kind: "todo", id: stored.id, items: input.items });
					}
					return;
				}
				if (tool === "question" && Schema.is(AssistantQuestionInput)(input)) {
					const value = stored.result?.truncated === false ? stored.result.value : null;
					const answers = Schema.is(QuestionAnswers)(value)
						? value.answers.map(({ answer }) => answer)
						: null;
					let state: "pending" | "expired" | "answered" = "expired";
					if (answers !== null) {
						state = "answered";
					} else if (stored.result === null && record.status === "awaiting-input") {
						state = "pending";
					}
					closeSteps();
					entries.push({
						state,
						answers,
						call: stored,
						id: stored.id,
						kind: "question",
						questions: input.questions,
					});
					return;
				}
				if (part.call.requiresApproval) {
					pushApproval(stored);
				} else {
					steps.push({
						kind: "tool",
						id: stored.id,
						tool: part.call.tool,
						arguments: part.call.arguments,
						status: stepStatus(stored, active),
					});
				}
				for (const child of record.calls.items) {
					if (child.call.kind === "capability" && child.call.parentId === stored.id) {
						pushApproval(child);
					}
				}
			}
		});
	}
	closeSteps();
	return {
		entries,
		id: record.id,
		prompt: record.text,
		status: record.status,
		failure: record.failure,
		createdAt: record.createdAt,
		queued: record.queued.items,
		completedAt: record.completedAt,
		partial: record.messages.pageInfo.hasMore || record.calls.pageInfo.hasMore,
	};
};
