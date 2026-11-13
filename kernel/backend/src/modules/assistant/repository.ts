import {
	type AnswerAssistantQuestionBody,
	ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH,
	type AssistantApprovalDecision,
	AssistantError,
	AssistantQuestionInput,
	AssistantMessagePart,
	AssistantToolCall,
	AssistantTurnFailure,
	type AssistantTurnStatus,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import { generateId } from "better-auth";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { truncateJsonResult } from "#platform/tool-result";
import {
	assistantConversation as conversations,
	assistantInbox as inbox,
	assistantMessage as messages,
	assistantToolCall as calls,
	assistantToolOutput as outputs,
	assistantTurn as turns,
} from "#schema/tables/assistant";

const activeStatuses: readonly AssistantTurnStatus[] = [
	"queued",
	"running",
	"awaiting-approval",
	"awaiting-input",
];
const isQuestion = (call: AssistantToolCall) => call.kind === "tool" && call.tool === "question";
const pendingStatus = (
	pending: ReadonlyArray<{
		readonly call: AssistantToolCall;
		readonly result: null | AgentToolResult;
		readonly decision: null | AssistantApprovalDecision;
	}>,
) => {
	const unfinished = pending.filter((item) => item.result === null);
	if (unfinished.some((item) => item.call.requiresApproval && item.decision === null)) {
		return "awaiting-approval" as const;
	}
	return unfinished.some((item) => isQuestion(item.call)) ? "awaiting-input" : "running";
};
const interruptedResult: AgentToolResult = { truncated: false, value: { interrupted: true } };
const fail = (code: AssistantError["reason"]["code"]) => new AssistantError({ reason: { code } });
export const conversationTitle = (text: string) => {
	const title = text.replaceAll(/\s+/g, " ").trim();
	return title.length <= ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH
		? title
		: `${title.slice(0, ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
};
export class AssistantRepository extends Context.Service<AssistantRepository>()(
	"@ryot-app/kernel-backend/modules/assistant/repository/AssistantRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const lockConversation = Effect.fn("AssistantRepository.lockConversation")(function* (
				userId: UserId,
				conversationId: string,
			) {
				yield* session.requireTransaction;
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(conversations)
						.where(and(eq(conversations.userId, userId), eq(conversations.id, conversationId)))
						.for("update"),
				);
				if (!row) {
					return yield* fail("conversation-not-found");
				}
				return row;
			});
			const lockTurn = Effect.fn("AssistantRepository.lockTurn")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				expectedRevision: number,
			) {
				yield* lockConversation(userId, conversationId);
				const [row] = yield* session.run((db) =>
					db
						.select()
						.from(turns)
						.where(
							and(
								eq(turns.id, turnId),
								eq(turns.conversationId, conversationId),
								eq(turns.userId, userId),
							),
						)
						.for("update"),
				);
				if (!row) {
					return yield* fail("turn-not-found");
				}
				if (row.revision !== expectedRevision) {
					return yield* fail("revision-stale");
				}
				if (!activeStatuses.includes(row.status)) {
					return yield* fail("turn-not-active");
				}
				return row;
			});
			const appendMessage = Effect.fn("AssistantRepository.appendMessage")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				role: typeof messages.$inferInsert.role,
				parts: readonly AssistantMessagePart[],
				id: string = generateId(),
			) {
				const validated = yield* Schema.decodeEffect(Schema.Array(AssistantMessagePart))(parts);
				const [conversation] = yield* session.run((db) =>
					db
						.update(conversations)
						.set({
							updatedAt: sql`now()`,
							revision: sql`${conversations.revision} + 1`,
							nextSequence: sql`${conversations.nextSequence} + 1`,
						})
						.where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
						.returning({ sequence: conversations.nextSequence }),
				);
				if (!conversation) {
					return yield* fail("conversation-not-found");
				}
				yield* session.run((db) =>
					db
						.insert(messages)
						.values({
							id,
							role,
							userId,
							turnId,
							conversationId,
							parts: validated,
							sequence: conversation.sequence - 1,
						}),
				);
				return undefined;
			});
			const bumpTurn = Effect.fn("AssistantRepository.bumpTurn")(function* (
				turnId: string,
				patch: Partial<Pick<typeof turns.$inferInsert, "round" | "status" | "failure">>,
			) {
				const [row] = yield* session.run((db) =>
					db
						.update(turns)
						.set({
							...patch,
							revision: sql`${turns.revision} + 1`,
							completedAt:
								patch.status && !activeStatuses.includes(patch.status) ? sql`now()` : undefined,
						})
						.where(eq(turns.id, turnId))
						.returning(),
				);
				if (!row) {
					return yield* Effect.die("Locked assistant turn disappeared");
				}
				return row;
			});
			const takeInbox = Effect.fn("AssistantRepository.takeInbox")(function* (turnId: string) {
				return yield* session.run((db) =>
					db
						.update(inbox)
						.set({ deliveredAt: sql`now()` })
						.where(and(eq(inbox.turnId, turnId), isNull(inbox.deliveredAt)))
						.returning(),
				).pipe(
					Effect.map((rows) =>
						rows.toSorted(
							(left, right) =>
								left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
						),
					),
				);
			});
			const refreshStatus = Effect.fn("AssistantRepository.refreshStatus")(function* (
				turnId: string,
			) {
				const pending = yield* session.run((db) =>
					db.select().from(calls).where(eq(calls.turnId, turnId)),
				);
				return yield* bumpTurn(turnId, { status: pendingStatus(pending) });
			});
			const renameConversation = Effect.fn("AssistantRepository.renameConversation")(function* (
				userId: UserId,
				conversationId: string,
				title: string,
			) {
				yield* lockConversation(userId, conversationId);
				yield* session.run((db) =>
					db
						.update(conversations)
						.set({ title, revision: sql`${conversations.revision} + 1` })
						.where(eq(conversations.id, conversationId)),
				);
				return undefined;
			});
			const deleteConversation = Effect.fn("AssistantRepository.deleteConversation")(function* (
				userId: UserId,
				conversationId: string,
			) {
				yield* lockConversation(userId, conversationId);
				const [active] = yield* session.run((db) =>
					db
						.select({ id: turns.id })
						.from(turns)
						.where(
							and(eq(turns.conversationId, conversationId), inArray(turns.status, activeStatuses)),
						)
						.limit(1),
				);
				if (active) {
					return yield* fail("conversation-active");
				}
				yield* session.run((db) =>
					db.delete(conversations).where(eq(conversations.id, conversationId)),
				);
				return undefined;
			});
			const submit = Effect.fn("AssistantRepository.submit")(function* (
				userId: UserId,
				input: { text: string; requestId: string; conversationId?: string | undefined },
			) {
				if (input.conversationId === undefined) {
					yield* session.requireTransaction;
				} else {
					yield* lockConversation(userId, input.conversationId);
				}
				const [existing] = yield* session.run((db) =>
					db
						.select()
						.from(turns)
						.where(and(eq(turns.userId, userId), eq(turns.requestId, input.requestId))),
				);
				if (existing) {
					if (
						existing.text !== input.text ||
						(input.conversationId !== undefined && existing.conversationId !== input.conversationId)
					) {
						return yield* fail("request-conflict");
					}
					return existing;
				}
				const [queued] = yield* session.run((db) =>
					db
						.select()
						.from(inbox)
						.where(and(eq(inbox.userId, userId), eq(inbox.requestId, input.requestId))),
				);
				if (queued) {
					const [owner] = yield* session.run((db) =>
						db.select().from(turns).where(eq(turns.id, queued.turnId)),
					);
					if (!owner || queued.text !== input.text || queued.conversationId !== input.conversationId) {
						return yield* fail("request-conflict");
					}
					return owner;
				}
				const conversationId = input.conversationId ?? generateId();
				if (input.conversationId === undefined) {
					yield* session.run((db) =>
						db
							.insert(conversations)
							.values({ userId, id: conversationId, title: conversationTitle(input.text) }),
					);
				} else {
					const [active] = yield* session.run((db) =>
						db
							.select()
							.from(turns)
							.where(
								and(
									eq(turns.conversationId, conversationId),
									inArray(turns.status, activeStatuses),
								),
							)
							.limit(1),
					);
					if (active) {
						yield* session.run((db) =>
							db.insert(inbox).values({
								userId,
								conversationId,
								id: generateId(),
								text: input.text,
								turnId: active.id,
								requestId: input.requestId,
							}),
						);
						return yield* bumpTurn(active.id, {});
					}
				}
				const [row] = yield* session.run((db) =>
					db
						.insert(turns)
						.values({
							userId,
							conversationId,
							id: generateId(),
							text: input.text,
							requestId: input.requestId,
						})
						.returning(),
				);
				if (!row) {
					return yield* Effect.die("Assistant turn insert returned no row");
				}
				yield* appendMessage(userId, conversationId, row.id, "user", [
					{ kind: "text", text: input.text },
				]);
				return row;
			});
			const interrupt = Effect.fn("AssistantRepository.interrupt")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
			) {
				yield* lockConversation(userId, conversationId);
				const [turn] = yield* session.run((db) =>
					db
						.select()
						.from(turns)
						.where(
							and(
								eq(turns.id, turnId),
								eq(turns.userId, userId),
								eq(turns.conversationId, conversationId),
							),
						)
						.for("update"),
				);
				if (!turn) {
					return yield* fail("turn-not-found");
				}
				if (!activeStatuses.includes(turn.status)) {
					return yield* fail("turn-not-active");
				}
				const unfinished = yield* session.run((db) =>
					db
						.select()
						.from(calls)
						.where(and(eq(calls.turnId, turnId), sql`${calls.result} is null`))
						.orderBy(asc(calls.round), asc(calls.position)),
				);
				if (unfinished.length > 0) {
					yield* session.run((db) =>
						db
							.update(calls)
							.set({ completedAt: sql`now()`, result: interruptedResult })
							.where(
								inArray(
									calls.id,
									unfinished.map((call) => call.id),
								),
							),
					);
				}
				const results = unfinished.flatMap((item) =>
					item.call.kind === "tool"
						? [
								{
									toolCallId: item.call.id,
									result: interruptedResult,
									kind: "tool-result" as const,
								},
							]
						: [],
				);
				if (results.length > 0) {
					yield* appendMessage(userId, conversationId, turnId, "tool", results);
				}
				const updated = yield* bumpTurn(turnId, { status: "interrupted" });
				const undelivered = yield* takeInbox(turnId);
				const [first] = undelivered;
				let next: null | typeof turns.$inferSelect = null;
				if (first) {
					const text = undelivered.map((item) => item.text).join("\n\n");
					[next = null] = yield* session.run((db) =>
						db
							.insert(turns)
							.values({ text, userId, conversationId, id: generateId(), requestId: `inbox:${first.id}` })
							.returning(),
					);
					if (next === null) {
						return yield* Effect.die("Assistant turn insert returned no row");
					}
					yield* appendMessage(userId, conversationId, next.id, "user", [{ kind: "text", text }]);
				}
				return {
					next,
					turn: updated,
					awaitingDecision: unfinished
						.filter(
							(item) =>
								(item.call.requiresApproval && item.decision === null) || isQuestion(item.call),
						)
						.map((item) => item.id),
				};
			});
			const transition = Effect.fn("AssistantRepository.transition")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				expectedRevision: number,
				status: "failed" | "running" | "completed" | "interrupted",
				failure: null | AssistantTurnFailure = null,
			) {
				const turn = yield* lockTurn(userId, conversationId, turnId, expectedRevision);
				if (failure !== null) {
					yield* Schema.decodeEffect(AssistantTurnFailure)(failure);
				}
				const pending = yield* session.run((db) =>
					db.select().from(calls).where(eq(calls.turnId, turnId)),
				);
				if (
					(status === "running" || status === "completed") &&
					pending.some((call) => call.result === null)
				) {
					return yield* fail("turn-not-active");
				}
				if (status === "running" && turn.status === "running") {
					return turn;
				}
				const updated = yield* bumpTurn(turnId, { status, failure });
				return updated;
			});
			const deliverInbox = Effect.fn("AssistantRepository.deliverInbox")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				expectedRevision: number,
			) {
				const turn = yield* lockTurn(userId, conversationId, turnId, expectedRevision);
				const delivered = yield* takeInbox(turnId);
				for (const item of delivered) {
					yield* appendMessage(userId, conversationId, turnId, "user", [
						{ kind: "text", text: item.text },
					]);
				}
				return delivered.length === 0 ? turn : yield* bumpTurn(turnId, {});
			});
			/** Completes the turn unless a message arrived for it, which the next round delivers instead. */
			const complete = Effect.fn("AssistantRepository.complete")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				expectedRevision: number,
			) {
				const locked = yield* lockTurn(userId, conversationId, turnId, expectedRevision);
				const [waiting] = yield* session.run((db) =>
					db
						.select({ id: inbox.id })
						.from(inbox)
						.where(and(eq(inbox.turnId, turnId), isNull(inbox.deliveredAt)))
						.limit(1),
				);
				if (waiting) {
					return { ...locked, completed: false };
				}
				return {
					...(yield* transition(userId, conversationId, turnId, expectedRevision, "completed")),
					completed: true,
				};
			});
			const setRoundText = Effect.fn("AssistantRepository.setRoundText")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				round: number,
				text: string,
			) {
				yield* lockConversation(userId, conversationId);
				const state = yield* loadTurn(userId, turnId);
				if (!state || state.turn.conversationId !== conversationId) {
					return yield* fail("turn-not-found");
				}
				if (state.turn.round >= round) {
					return state.turn;
				}
				if (state.turn.status !== "running" || state.turn.round !== round - 1) {
					return yield* fail("turn-not-active");
				}
				const id = `${turnId}:round:${round}:text`;
				const stored = state.messages.some((message) => message.id === id);
				if (text === "") {
					if (!stored) {
						return state.turn;
					}
					yield* session.run((db) => db.delete(messages).where(eq(messages.id, id)));
				} else if (stored) {
					yield* session.run((db) =>
						db
							.update(messages)
							.set({ parts: [{ text, kind: "text" }] })
							.where(eq(messages.id, id)),
					);
				} else {
					yield* appendMessage(
						userId,
						conversationId,
						turnId,
						"assistant",
						[{ text, kind: "text" }],
						id,
					);
				}
				return yield* bumpTurn(turnId, {});
			});

			const recordRound = Effect.fn("AssistantRepository.recordRound")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				expectedRevision: number,
				input: {
					text: string;
					calls: readonly AssistantToolCall[];
					parts?: readonly AssistantMessagePart[];
				},
			) {
				const turn = yield* lockTurn(userId, conversationId, turnId, expectedRevision);
				if (turn.status !== "running") {
					return yield* fail("turn-not-active");
				}
				const pending = yield* session.run((db) =>
					db.select().from(calls).where(eq(calls.turnId, turnId)),
				);
				if (pending.some((call) => call.result === null)) {
					return yield* fail("turn-not-active");
				}
				const toolCalls = yield* Schema.decodeEffect(Schema.Array(AssistantToolCall))(input.calls);
				const round = turn.round + 1;
				if (toolCalls.length > 0) {
					yield* session.run((db) =>
						db
							.insert(calls)
							.values(
								toolCalls.map((call, position) => ({
									call,
									round,
									userId,
									turnId,
									position,
									id: call.id,
									conversationId,
								})),
							),
					);
				}
				yield* appendMessage(userId, conversationId, turnId, "assistant", [
					...(input.text ? [{ text: input.text, kind: "text" as const }] : []),
					...toolCalls.map((call) => ({ call, kind: "tool-call" as const })),
					...(input.parts ?? []),
				]);
				const updated = yield* bumpTurn(turnId, {
					round,
					status: pendingStatus(
						toolCalls.map((call) => ({ call, result: null, decision: null })),
					),
				});
				return updated;
			});
			const decide = Effect.fn("AssistantRepository.decide")(function* (
				userId: UserId,
				input: {
					turnId: string;
					toolCallId: string;
					conversationId: string;
					expectedRevision: number;
					decision: AssistantApprovalDecision;
				},
			) {
				yield* lockConversation(userId, input.conversationId);
				const [call] = yield* session.run((db) =>
					db
						.select()
						.from(calls)
						.where(
							and(
								eq(calls.id, input.toolCallId),
								eq(calls.turnId, input.turnId),
								eq(calls.userId, userId),
								eq(calls.conversationId, input.conversationId),
							),
						)
						.for("update"),
				);
				if (!call) {
					return yield* fail("tool-call-not-found");
				}
				if (call.decision !== null) {
					if (call.decision === input.decision && call.revision === input.expectedRevision + 1) {
						return call;
					}
					return yield* fail("decision-conflict");
				}
				if (call.revision !== input.expectedRevision) {
					return yield* fail("revision-stale");
				}
				const [turn] = yield* session.run((db) =>
					db.select().from(turns).where(eq(turns.id, input.turnId)),
				);
				if (
					turn?.status !== "awaiting-approval" ||
					!call.call.requiresApproval ||
					call.result !== null
				) {
					return yield* fail("turn-not-active");
				}
				const [updated] = yield* session.run((db) =>
					db
						.update(calls)
						.set({ decidedAt: sql`now()`, decision: input.decision, revision: call.revision + 1 })
						.where(eq(calls.id, call.id))
						.returning(),
				);
				yield* appendMessage(userId, input.conversationId, input.turnId, "user", [
					{
						kind: "approval",
						toolCallId: call.call.id,
						decision: input.decision,
						revision: call.revision + 1,
					},
				]);
				yield* bumpTurn(input.turnId, {});
				return updated;
			});
			const answer = Effect.fn("AssistantRepository.answer")(function* (
				userId: UserId,
				input: AnswerAssistantQuestionBody,
			) {
				yield* lockConversation(userId, input.conversationId);
				const [call] = yield* session.run((db) =>
					db
						.select()
						.from(calls)
						.where(
							and(
								eq(calls.id, input.toolCallId),
								eq(calls.turnId, input.turnId),
								eq(calls.userId, userId),
								eq(calls.conversationId, input.conversationId),
							),
						)
						.for("update"),
				);
				if (!call || !isQuestion(call.call)) {
					return yield* fail("tool-call-not-found");
				}
				const asked = yield* Schema.decodeUnknownEffect(AssistantQuestionInput)(
					call.call.arguments,
				).pipe(Effect.mapError(() => fail("answer-invalid")));
				if (asked.questions.length !== input.answers.length) {
					return yield* fail("answer-invalid");
				}
				const result = truncateJsonResult({
					answers: asked.questions.map(({ question }, index) => ({
						question,
						answer: input.answers[index] ?? "",
					})),
				});
				if (call.result !== null) {
					return stableStringify(call.result) === stableStringify(result)
						? undefined
						: yield* fail("decision-conflict");
				}
				const [turn] = yield* session.run((db) =>
					db.select().from(turns).where(eq(turns.id, input.turnId)),
				);
				if (turn?.status !== "awaiting-input") {
					return yield* fail("turn-not-active");
				}
				yield* session.run((db) =>
					db
						.update(calls)
						.set({ result, completedAt: sql`now()`, revision: call.revision + 1 })
						.where(eq(calls.id, call.id)),
				);
				yield* appendMessage(userId, input.conversationId, input.turnId, "tool", [
					{ result, kind: "tool-result", toolCallId: call.call.id },
				]);
				yield* refreshStatus(input.turnId);
				return undefined;
			});
			const recordResult = Effect.fn("AssistantRepository.recordResult")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				expectedRevision: number,
				toolCallId: string,
				result: AgentToolResult,
				parts: readonly AssistantMessagePart[] = [],
				output: null | string = null,
			) {
				yield* lockTurn(userId, conversationId, turnId, expectedRevision);
				const validated = yield* Schema.decodeEffect(AgentToolResult)(result);
				if (validated.truncated === "retained") {
					if (output === null) {
						return yield* Effect.die("A retained tool result needs its full output");
					}
					yield* session.run((db) =>
						db
							.insert(outputs)
							.values({ userId, turnId, text: output, conversationId, id: validated.outputId }),
					);
				}
				const [call] = yield* session.run((db) =>
					db
						.select()
						.from(calls)
						.where(and(eq(calls.id, toolCallId), eq(calls.turnId, turnId)))
						.for("update"),
				);
				if (!call) {
					return yield* fail("tool-call-not-found");
				}
				if (call.result !== null || (call.call.requiresApproval && call.decision === null)) {
					return yield* fail("turn-not-active");
				}
				yield* session.run((db) =>
					db
						.update(calls)
						.set({ result: validated, completedAt: sql`now()` })
						.where(eq(calls.id, toolCallId)),
				);
				const children = yield* session.run((db) =>
					db.select().from(calls).where(eq(calls.turnId, turnId)),
				);
				const unsettled = children
					.filter(
						(item) =>
							item.result === null &&
							item.call.kind === "capability" &&
							item.call.parentId === call.call.id,
					)
					.map((item) => item.id);
				if (unsettled.length > 0) {
					yield* session.run((db) =>
						db
							.update(calls)
							.set({
								completedAt: sql`now()`,
								result: { truncated: false, value: { error: "not-executed" } },
							})
							.where(inArray(calls.id, unsettled)),
					);
				}
				yield* appendMessage(userId, conversationId, turnId, "tool", [
					{ result: validated, kind: "tool-result", toolCallId: call.call.id },
					...parts,
				]);
				return yield* refreshStatus(turnId);
			});
			const recordCapabilityCall = Effect.fn("AssistantRepository.recordCapabilityCall")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				expectedRevision: number,
				input: AssistantToolCall,
			) {
				const turn = yield* lockTurn(userId, conversationId, turnId, expectedRevision);
				const call = yield* Schema.decodeEffect(AssistantToolCall)(input);
				if (call.kind !== "capability") {
					return yield* fail("tool-call-not-found");
				}
				const existing = yield* session.run((db) =>
					db.select().from(calls).where(eq(calls.turnId, turnId)),
				);
				const parent = existing.find((item) => item.id === call.parentId);
				if (parent?.result !== null) {
					return yield* fail("turn-not-active");
				}
				if (existing.some((item) => item.id === call.id)) {
					return turn;
				}
				yield* session.run((db) =>
					db
						.insert(calls)
						.values({
							call,
							userId,
							turnId,
							id: call.id,
							conversationId,
							round: parent.round,
							position: Math.max(...existing.map((item) => item.position)) + 1,
						}),
				);
				return yield* bumpTurn(turnId, { status: "awaiting-approval" });
			});
			const settleCapabilityCall = Effect.fn("AssistantRepository.settleCapabilityCall")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				expectedRevision: number,
				toolCallId: string,
				result: AgentToolResult,
			) {
				yield* lockTurn(userId, conversationId, turnId, expectedRevision);
				const validated = yield* Schema.decodeEffect(AgentToolResult)(result);
				const [call] = yield* session.run((db) =>
					db
						.select()
						.from(calls)
						.where(and(eq(calls.id, toolCallId), eq(calls.turnId, turnId)))
						.for("update"),
				);
				if (call?.call.kind !== "capability") {
					return yield* fail("tool-call-not-found");
				}
				if (call.result !== null || call.decision === null) {
					return yield* fail("turn-not-active");
				}
				yield* session.run((db) =>
					db
						.update(calls)
						.set({ result: validated, completedAt: sql`now()` })
						.where(eq(calls.id, toolCallId)),
				);
				return yield* refreshStatus(turnId);
			});
			const readOutput = Effect.fn("AssistantRepository.readOutput")(function* (
				userId: UserId,
				conversationId: string,
				outputId: string,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({ text: outputs.text })
						.from(outputs)
						.where(
							and(
								eq(outputs.id, outputId),
								eq(outputs.userId, userId),
								eq(outputs.conversationId, conversationId),
							),
						),
				);
				return row?.text ?? null;
			});
			const recordPromptUsage = Effect.fn("AssistantRepository.recordPromptUsage")(function* (
				userId: UserId,
				conversationId: string,
				usage: { readonly tokens: number; readonly characters: number },
			) {
				yield* session.run((db) =>
					db
						.update(conversations)
						.set({ promptTokens: usage.tokens, promptCharacters: usage.characters })
						.where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
				);
			});
			const appendTurnMessage = Effect.fn("AssistantRepository.appendTurnMessage")(function* (
				userId: UserId,
				conversationId: string,
				turnId: string,
				expectedRevision: number,
				message: {
					readonly id: string;
					readonly role: "user" | "assistant";
					readonly parts: readonly AssistantMessagePart[];
				},
			) {
				const turn = yield* lockTurn(userId, conversationId, turnId, expectedRevision);
				const [existing] = yield* session.run((db) =>
					db.select({ id: messages.id }).from(messages).where(eq(messages.id, message.id)),
				);
				if (existing) {
					return turn;
				}
				yield* appendMessage(
					userId,
					conversationId,
					turnId,
					message.role,
					message.parts,
					message.id,
				);
				return yield* bumpTurn(turnId, {});
			});
			const loadTurn = Effect.fn("AssistantRepository.loadTurn")(function* (
				userId: UserId,
				turnId: string,
			) {
				const [turn] = yield* session.run((db) =>
					db
						.select()
						.from(turns)
						.where(and(eq(turns.id, turnId), eq(turns.userId, userId))),
				);
				if (!turn) {
					return null;
				}
				const history = yield* session.run((db) =>
					db
						.select()
						.from(messages)
						.where(
							and(eq(messages.conversationId, turn.conversationId), eq(messages.userId, userId)),
						)
						.orderBy(asc(messages.sequence)),
				);
				const toolCalls = yield* session.run((db) =>
					db
						.select()
						.from(calls)
						.where(eq(calls.turnId, turnId))
						.orderBy(asc(calls.round), asc(calls.position)),
				);
				const [conversation] = yield* session.run((db) =>
					db
						.select({
							promptTokens: conversations.promptTokens,
							promptCharacters: conversations.promptCharacters,
						})
						.from(conversations)
						.where(eq(conversations.id, turn.conversationId)),
				);
				const measurement =
					conversation?.promptTokens != null && conversation.promptCharacters != null
						? { tokens: conversation.promptTokens, characters: conversation.promptCharacters }
						: null;
				return { turn, measurement, calls: toolCalls, messages: history };
			});
			const recoverableTurns = session.run((db) =>
				db
					.select()
					.from(turns)
					.where(inArray(turns.status, activeStatuses))
					.orderBy(asc(turns.createdAt)),
			);
			return {
				submit,
				decide,
				answer,
				complete,
				deliverInbox,
				loadTurn,
				interrupt,
				transition,
				readOutput,
				recordRound,
				setRoundText,
				recordResult,
				recoverableTurns,
				appendTurnMessage,
				recordPromptUsage,
				renameConversation,
				deleteConversation,
				recordCapabilityCall,
				settleCapabilityCall,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
