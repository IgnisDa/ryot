import { expect } from "bun:test";

import {
	AssistantError,
	type AssistantToolCall,
} from "@ryot-app/contract/modules/assistant/schemas";
import { AssistantToolCallId, UserId } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
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
layer(AssistantRepository.layer.pipe(Layer.provideMerge(database)))((test) => {
	test.effect(
		"replays submissions, rejects competing work and active deletion, and isolates owners",
		() =>
			Effect.gen(function* () {
				const repository = yield* AssistantRepository;
				const session = yield* DatabaseSession;
				const { conversationId } = yield* session.transaction(
					repository.createConversation(owner, "Question"),
				);
				const input = { conversationId, requestId: "first", text: "Read my records" };
				const turn = yield* session.transaction(repository.submit(owner, input));
				const retry = yield* session.transaction(repository.submit(owner, input));
				expect(retry.id).toBe(turn.id);
				assertExitFails(
					yield* Effect.exit(
						session.transaction(repository.submit(owner, { ...input, text: "Different" })),
					),
					new AssistantError({ reason: { code: "request-conflict" } }),
				);
				assertExitFails(
					yield* Effect.exit(
						session.transaction(repository.submit(owner, { ...input, requestId: "second" })),
					),
					new AssistantError({ reason: { code: "conversation-active" } }),
				);
				assertExitFails(
					yield* Effect.exit(
						session.transaction(repository.deleteConversation(owner, conversationId)),
					),
					new AssistantError({ reason: { code: "conversation-active" } }),
				);
				expect(yield* repository.loadTurn(other, turn.id)).toBeNull();
				assertExitFails(
					yield* Effect.exit(session.transaction(repository.submit(other, input))),
					new AssistantError({ reason: { code: "conversation-not-found" } }),
				);
				const persisted = yield* repository.loadTurn(owner, turn.id);
				assert(persisted);
				expect(persisted.messages.map((message) => message.parts)).toEqual([
					[{ kind: "text", text: input.text }],
				]);
				expect((yield* repository.recoverableTurns).some((item) => item.id === turn.id)).toBe(true);
				yield* session.transaction(
					repository.transition(owner, conversationId, turn.id, turn.revision, "interrupted"),
				);
				yield* session.transaction(repository.deleteConversation(owner, conversationId));
				expect(yield* repository.loadTurn(owner, turn.id)).toBeNull();
			}),
	);
	test.effect("persists immutable tool pins, fences decisions and preserves ordered results", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const session = yield* DatabaseSession;
			const { conversationId } = yield* session.transaction(
				repository.createConversation(owner, "Approval"),
			);
			const queued = yield* session.transaction(
				repository.submit(owner, { conversationId, text: "Run a script", requestId: "approval" }),
			);
			const running = yield* session.transaction(
				repository.transition(owner, conversationId, queued.id, queued.revision, "running"),
			);
			assert(running);
			const call: AssistantToolCall = {
				requiresApproval: true,
				modelCallId: "model-call",
				id: AssistantToolCallId.make("approval-call"),
				arguments: { source: "source", allowWrites: true },
				descriptor: {
					name: "run_script",
					description: "Script",
					input: { type: "object" },
					output: { type: "object" },
					source: { kind: "run-script" },
					hints: { readOnly: false, destructive: true, idempotent: false },
				},
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
});
