import { expect } from "bun:test";

import {
	AssistantError,
	type AssistantToolCall,
} from "@ryot-app/contract/modules/assistant/schemas";
import { AssistantToolCallId, UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { assistantConversation } from "#schema/tables/assistant";
import { user } from "#schema/tables/auth";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { AssistantRepository } from "./repository";

const owner = UserId.make("assistant-owner");
const other = UserId.make("assistant-other");
const database = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.insert(user).values([
				{ id: owner, name: "Owner", email: "assistant-owner@example.test" },
				{ id: other, name: "Other", email: "assistant-other@example.test" },
			]),
		);
	}),
).pipe(Layer.provideMerge(isolatedDatabaseLayer("assistant_repository")));
const titles = Effect.fn(function* (conversationId: string) {
	const session = yield* DatabaseSession;
	return yield* session.run((db) =>
		db
			.select({ title: assistantConversation.title })
			.from(assistantConversation)
			.where(eq(assistantConversation.id, conversationId)),
	);
});
layer(AssistantRepository.layer.pipe(Layer.provideMerge(database)))((test) => {
	test.effect(
		"creates titled conversations, replays submissions, queues messages for the active turn, rejects active deletion, and isolates owners",
		() =>
			Effect.gen(function* () {
				const repository = yield* AssistantRepository;
				const session = yield* DatabaseSession;
				const first = { requestId: "first", text: "Read   my\nrecords" };
				const turn = yield* session.transaction(repository.submit(owner, first));
				const { conversationId } = turn;
				expect(yield* titles(conversationId)).toEqual([{ title: "Read my records" }]);
				const retry = yield* session.transaction(repository.submit(owner, first));
				expect(retry.id).toBe(turn.id);
				const input = { ...first, conversationId };
				expect((yield* session.transaction(repository.submit(owner, input))).id).toBe(turn.id);
				assertExitFails(
					yield* Effect.exit(
						session.transaction(repository.submit(owner, { ...input, text: "Different" })),
					),
					new AssistantError({ reason: { code: "request-conflict" } }),
				);
				const queued = yield* session.transaction(
					repository.submit(owner, { ...input, requestId: "second", text: "Also my notes" }),
				);
				expect(queued.id).toBe(turn.id);
				assertExitFails(
					yield* Effect.exit(
						session.transaction(repository.deleteConversation(owner, conversationId)),
					),
					new AssistantError({ reason: { code: "conversation-active" } }),
				);
				expect(yield* repository.loadTurn(other, turn.id)).toBeNull();
				assertExitFails(
					yield* Effect.exit(
						session.transaction(repository.submit(other, { ...input, requestId: "other" })),
					),
					new AssistantError({ reason: { code: "conversation-not-found" } }),
				);
				assertExitFails(
					yield* Effect.exit(
						session.transaction(repository.renameConversation(other, conversationId, "Stolen")),
					),
					new AssistantError({ reason: { code: "conversation-not-found" } }),
				);
				yield* session.transaction(
					repository.renameConversation(owner, conversationId, "Record review"),
				);
				expect(yield* titles(conversationId)).toEqual([{ title: "Record review" }]);
				const long = yield* session.transaction(
					repository.submit(owner, { requestId: "long", text: "a".repeat(80) }),
				);
				expect(yield* titles(long.conversationId)).toEqual([{ title: `${"a".repeat(59)}…` }]);
				const persisted = yield* repository.loadTurn(owner, turn.id);
				assert(persisted);
				expect(persisted.messages.map((message) => message.parts)).toEqual([
					[{ kind: "text", text: first.text }],
				]);
				expect((yield* repository.recoverableTurns).some((item) => item.id === turn.id)).toBe(true);
				yield* session.transaction(
					repository.transition(owner, conversationId, turn.id, queued.revision, "interrupted"),
				);
				yield* session.transaction(repository.deleteConversation(owner, conversationId));
				expect(yield* repository.loadTurn(owner, turn.id)).toBeNull();
			}),
	);
	test.effect("persists immutable tool pins, fences decisions and preserves ordered results", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const session = yield* DatabaseSession;
			const queued = yield* session.transaction(
				repository.submit(owner, { text: "Run a script", requestId: "approval" }),
			);
			const { conversationId } = queued;
			const running = yield* session.transaction(
				repository.transition(owner, conversationId, queued.id, queued.revision, "running"),
			);
			assert(running);
			const call: AssistantToolCall = {
				kind: "tool",
				tool: "page_publish",
				requiresApproval: true,
				modelCallId: "model-call",
				id: AssistantToolCallId.make("approval-call"),
				arguments: { pageId: "page", expectedDraftRevision: 1 },
			};
			const paused = yield* session.transaction(
				repository.recordRound(owner, conversationId, queued.id, running.revision, {
					calls: [call],
					text: "Confirm this call",
				}),
			);
			assert(paused);
			expect(paused.status).toBe("awaiting-approval");
			const decision = {
				conversationId,
				turnId: queued.id,
				toolCallId: call.id,
				expectedRevision: 1,
				decision: "approve" as const,
			};
			const approved = yield* session.transaction(repository.decide(owner, decision));
			expect(approved?.decision).toBe("approve");
			expect((yield* session.transaction(repository.decide(owner, decision)))?.revision).toBe(2);
			assertExitFails(
				yield* Effect.exit(
					session.transaction(repository.decide(owner, { ...decision, decision: "decline" })),
				),
				new AssistantError({ reason: { code: "decision-conflict" } }),
			);
			const state = yield* repository.loadTurn(owner, queued.id);
			assert(state);
			expect(state.calls[0]?.call).toEqual(call);
			assertExitFails(
				yield* Effect.exit(
					session.transaction(
						repository.recordResult(owner, conversationId, queued.id, paused.revision, call.id, {
							value: "done",
							truncated: false,
						}),
					),
				),
				new AssistantError({ reason: { code: "revision-stale" } }),
			);
			const result = yield* session.transaction(
				repository.recordResult(owner, conversationId, queued.id, state.turn.revision, call.id, {
					value: "done",
					truncated: false,
				}),
			);
			assert(result);
			yield* session.transaction(
				repository.transition(owner, conversationId, queued.id, result.revision, "completed"),
			);
			const final = yield* repository.loadTurn(owner, queued.id);
			assert(final);
			expect(final.turn.status).toBe("completed");
			expect(final.messages.map((message) => message.sequence)).toEqual([1, 2, 3, 4]);
			expect(final.messages[3]?.parts).toEqual([
				{ kind: "tool-result", toolCallId: call.id, result: { value: "done", truncated: false } },
			]);
		}),
	);
	test.effect("interrupts active turns, settles unfinished calls and skips empty round text", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const session = yield* DatabaseSession;
			const queued = yield* session.transaction(
				repository.submit(owner, { text: "Delete my page", requestId: "interrupt" }),
			);
			const { conversationId } = queued;
			const running = yield* session.transaction(
				repository.transition(owner, conversationId, queued.id, queued.revision, "running"),
			);
			const unchanged = yield* session.transaction(
				repository.setRoundText(owner, conversationId, queued.id, 1, ""),
			);
			expect(unchanged.revision).toBe(running.revision);
			const call: AssistantToolCall = {
				kind: "tool",
				tool: "page_publish",
				requiresApproval: true,
				modelCallId: "interrupt-call",
				id: AssistantToolCallId.make("interrupt-call"),
				arguments: { pageId: "page", expectedDraftRevision: 1 },
			};
			yield* session.transaction(
				repository.recordRound(owner, conversationId, queued.id, running.revision, {
					text: "",
					calls: [call],
				}),
			);
			const { turn, awaitingDecision } = yield* session.transaction(
				repository.interrupt(owner, conversationId, queued.id),
			);
			expect(turn.status).toBe("interrupted");
			expect(awaitingDecision).toEqual([call.id]);
			const state = yield* repository.loadTurn(owner, queued.id);
			assert(state);
			const interrupted = { truncated: false as const, value: { interrupted: true } };
			expect(state.calls.map((item) => item.result)).toEqual([interrupted]);
			expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
			expect(state.messages[2]?.parts).toEqual([
				{ kind: "tool-result", toolCallId: call.id, result: interrupted },
			]);
			assertExitFails(
				yield* Effect.exit(
					session.transaction(repository.interrupt(owner, conversationId, queued.id)),
				),
				new AssistantError({ reason: { code: "turn-not-active" } }),
			);
		}),
	);
});
