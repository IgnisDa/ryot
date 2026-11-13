import { expect } from "bun:test";

import { AuthUnauthorized, DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import { BadRequest, DbError } from "@ryot-app/contract/errors";
import {
	AssistantError,
	type AssistantTurnFailure,
} from "@ryot-app/contract/modules/assistant/schemas";
import { agentTools } from "@ryot-app/contract/schema/agent-tool";
import {
	AssistantConversationId,
	AssistantTurnId,
	SavedViewId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { CapabilityId } from "@ryot-app/contract/schema/capability";
import { AgentToolResult } from "@ryot-app/contract/schema/tool-result";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { layer } from "@voila.dev/effect-bun-test";
import { asc, eq } from "drizzle-orm";
import { Effect, Exit, Layer, Option, Schedule, Stream } from "effect";

import { UserLifecycleRepository } from "#modules/accounts/lifecycle/repository";
import type { AgentToolOutcome } from "#modules/agent-tools/service";
import { idempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";
import { AgentRunSuspended } from "#modules/scripts/agent/service";
import { DatabaseSession } from "#platform/db/session";
import { truncateJsonResult } from "#platform/tool-result";
import { PostgresWorkflowEngine } from "#platform/workflow/engine";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { assistantTurn } from "#schema/tables/assistant";
import { user } from "#schema/tables/auth";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { AssistantRecoveryLive } from "./layer";
import {
	AssistantModelError,
	type AssistantModelEvent,
	type AssistantModelRequest,
} from "./provider-model";
import { AssistantProviderRepository } from "./provider-repository";
import { AssistantRepository } from "./repository";
import { makeAssistantSavePage } from "./save-page";
import { AssistantService, makeAssistantService } from "./service";
import { AssistantTurnRuntime, makeAssistantTurnRuntime } from "./turn-runtime";
import { AssistantTurnWorkflow } from "./workflow";
import { AssistantWorkflowLive } from "./workflow-live";

const owner = UserId.make("assistant-loop-owner");
const other = UserId.make("assistant-loop-other");
const writeCapability = {
	title: "Delete page",
	input: { type: "object" },
	output: { type: "object" },
	description: "Delete a page",
	source: { kind: "kernel" as const },
	id: CapabilityId.make("kernel:pages.delete"),
	hints: { readOnly: false, idempotent: false, destructive: true },
};
const preview = {
	pageId: "page",
	draftRevision: 1,
	artifactHash: "artifact",
	definitionHash: "definition",
};
const account = () =>
	Effect.succeed({
		authorization: { writeAccess: "confirm" as const, accessClass: "standard" as const },
	});
const database = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.insert(user).values([
				{
					id: owner,
					name: "Owner",
					bootstrapCompletedAt: new Date(),
					email: "assistant-loop-owner@example.test",
				},
				{
					id: other,
					name: "Other",
					bootstrapCompletedAt: new Date(),
					email: "assistant-loop-other@example.test",
				},
			]),
		);
	}),
).pipe(Layer.provideMerge(isolatedDatabaseLayer("assistant_loop")));
const services = Layer.mergeAll(
	AssistantRepository.layer,
	IdempotencyKeys.layer,
	UserLifecycleRepository.layer,
	AssistantProviderRepository.layer,
).pipe(Layer.provideMerge(database));
const until = <E, R>(condition: Effect.Effect<boolean, E, R>) =>
	condition.pipe(
		Effect.flatMap((ready) => (ready ? Effect.void : Effect.fail("pending" as const))),
		Effect.retry(Schedule.spaced("10 millis")),
		Effect.timeout("10 seconds"),
		Effect.orDie,
	);
const withEngine =
	<ROut, RIn>(engine: Layer.Layer<ROut, never, RIn>) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.scoped(
			Effect.flatMap(Layer.build(engine), (context) => Effect.provideContext(effect, context)),
		);
const engineFor = (runtime: AssistantTurnRuntime["Service"]) =>
	AssistantWorkflowLive.pipe(
		Layer.provide(Layer.succeed(AssistantTurnRuntime, runtime)),
		Layer.provideMerge(
			PostgresWorkflowEngine.pipe(Layer.provide(WorkflowExecutionNotifications.layer)),
		),
		Layer.fresh,
	);
let admissions = 0;
const admit = Effect.fn(function* () {
	const repository = yield* AssistantRepository;
	const session = yield* DatabaseSession;
	const turn = yield* session.transaction(
		repository.submit(owner, { text: "Create a page", requestId: `request-${admissions++}` }),
	);
	return { userId: owner, turnId: turn.id };
});
const harness = Effect.fn(function* (
	options: {
		readonly readOnly?: boolean;
		readonly failBuild?: boolean;
		readonly reasoning?: boolean;
		readonly callRounds?: number;
		readonly noProvider?: boolean;
		readonly gatedWrite?: boolean;
		readonly resultBytes?: number;
		readonly contextWindow?: number;
		readonly overflowRound?: number;
		readonly cutFirstReply?: boolean;
		readonly readStoredResult?: boolean;
		readonly invalidArguments?: boolean;
		readonly interruptAfterWrite?: boolean;
		readonly localCalls?: ReadonlyArray<{ readonly name: string; readonly arguments: JsonValue }>;
		readonly failProvider?: AssistantModelError["code"];
	} = {},
) {
	const session = yield* DatabaseSession;
	const keys = yield* IdempotencyKeys;
	const writes: string[] = [];
	const invocations: string[] = [];
	let generated = 0;
	let summaries = 0;
	let firstCallId: null | string = null;
	let overflowed = false;
	const requests: AssistantModelRequest[] = [];
	const repository = yield* AssistantRepository;
	let steer: null | { readonly text: string; readonly conversationId: string } = null;
	let changed = false;
	let interrupted = false;
	let retired = false;
	const tool = options.gatedWrite ? agentTools.execute : agentTools.page_write;
	const requiresApproval = !options.readOnly && !options.gatedWrite;
	const runtime = yield* makeAssistantTurnRuntime({
		checkAccount: () =>
			retired
				? Effect.fail(new AuthUnauthorized({ reason: { code: "authentication-required" } }))
				: Effect.void,
		providers: {
			effective: () =>
				Effect.succeed(
					options.noProvider
						? null
						: {
								model: "test",
								apiKey: undefined,
								source: "instance",
								maxOutputTokens: 8_000,
								baseUrl: "https://provider.test/v1",
								contextWindow: options.contextWindow ?? 496_000,
							},
				),
		},
		model: {
			stream: (request) => {
				if (request.tools.length === 0) {
					summaries += 1;
					return Stream.fromIterable<AssistantModelEvent>([
						{ type: "text-delta", text: `Summary ${summaries}` },
						{ type: "finish", reason: "stop" },
					]);
				}
				requests.push(request);
				generated += 1;
				if (steer !== null) {
					const { text, conversationId } = steer;
					steer = null;
					return Stream.fromEffect(
						session
							.transaction(
								repository.submit(owner, { text, conversationId, requestId: `steer-${generated}` }),
							)
							.pipe(Effect.orDie),
					).pipe(
						Stream.flatMap(() =>
							Stream.fromIterable<AssistantModelEvent>([
								{ type: "text-delta", text: "Working on it." },
								{ type: "finish", reason: "stop" },
							]),
						),
					);
				}
				if (options.failProvider) {
					return Stream.fail(new AssistantModelError({ code: options.failProvider }));
				}
				if (generated === options.overflowRound && !overflowed) {
					overflowed = true;
					generated -= 1;
					return Stream.fail(new AssistantModelError({ code: "context-overflow" }));
				}
				const events: AssistantModelEvent[] = [{ type: "text-delta", text: "x".repeat(600) }];
				if (options.reasoning) {
					events.push(
						{ text: "Need ", field: "reasoning", type: "reasoning-delta" },
						{ text: "a page.", field: "reasoning", type: "reasoning-delta" },
					);
				}
				if (options.cutFirstReply && generated === 1) {
					events.push({ type: "finish", reason: "length" });
					return Stream.fromIterable(events);
				}
				if (options.readStoredResult && generated === 2 && firstCallId !== null) {
					events.push({
						type: "tool-call",
						name: "read_result",
						modelCallId: "model-read",
						arguments: { limit: 2, offset: 2_000, outputId: firstCallId },
					});
				} else if (options.localCalls && generated === 1) {
					for (const [index, call] of options.localCalls.entries()) {
						events.push({ ...call, type: "tool-call", modelCallId: `model-local-${index}` });
					}
				} else if (!options.localCalls && generated <= (options.callRounds ?? 1)) {
					events.push({
						arguments: {},
						name: tool.name,
						type: "tool-call",
						modelCallId: `model-${generated}`,
					});
				}
				events.push({ type: "finish", reason: "stop" });
				return Stream.fromIterable(events);
			},
		},
		tools: {
			listTrusted: () => Effect.succeed([tool]),
			validateTrusted: () =>
				options.invalidArguments
					? Effect.fail(new BadRequest({ message: 'Expected string at ["query"]' }))
					: Effect.succeed({
							tool,
							requiresApproval: changed ? !requiresApproval : requiresApproval,
						}),
			callTrusted: (userId, input) =>
				Effect.gen(function* () {
					invocations.push(input.idempotencyKey);
					firstCallId ??= input.idempotencyKey.replace(/^assistant:[^:]+:/, "");
					if (options.resultBytes !== undefined) {
						return {
							state: "completed",
							result: truncateJsonResult(
								Array.from({ length: options.resultBytes / 10 }, (_, line) => `line ${line}`).join(
									"\n",
								),
								input.byteBudget,
							),
						} satisfies AgentToolOutcome;
					}
					if (options.failBuild) {
						return {
							state: "completed",
							result: truncateJsonResult({ code: "TS2304", error: "build-failed" }),
						} satisfies AgentToolOutcome;
					}
					if (options.gatedWrite) {
						const write = { index: 0, input: { pageId: "page" }, capability: writeCapability };
						const gate = input.confirm;
						assert(gate !== null);
						const decision = yield* gate
							.authorize(write)
							.pipe(
								Effect.catch((error) =>
									error instanceof AgentRunSuspended ? Effect.succeed(null) : Effect.die(error),
								),
							);
						if (decision === null) {
							return { state: "suspended" } satisfies AgentToolOutcome;
						}
						if (!decision.approved) {
							return {
								state: "completed",
								result: truncateJsonResult({ refused: decision.reason }),
							} satisfies AgentToolOutcome;
						}
						writes.push(input.idempotencyKey);
						yield* gate.settle(write, { state: "success", value: { deleted: true } });
						return {
							state: "completed",
							result: truncateJsonResult({ deleted: true }),
						} satisfies AgentToolOutcome;
					}
					const result = yield* session
						.transaction(
							keys.once(
								idempotencyIdentity({
									userId,
									kind: "test:write",
									request: input.arguments,
									key: input.idempotencyKey,
								}),
								AgentToolResult,
								Effect.sync(() => {
									writes.push(input.idempotencyKey);
									return { value: preview, truncated: false } as const;
								}),
							),
						)
						.pipe(Effect.catchTag("IdempotencyConflict", Effect.die));
					if (options.interruptAfterWrite && !interrupted) {
						interrupted = true;
						return yield* Effect.interrupt;
					}
					return { result, preview, state: "completed" } satisfies AgentToolOutcome;
				}),
		},
	});
	return {
		writes,
		runtime,
		requests,
		invocations,
		summaries: () => summaries,
		steerNext: (conversationId: string, text: string) => {
			steer = { text, conversationId };
		},
		generated: () => generated,
		retire: () => {
			retired = true;
		},
		changeDescriptor: () => {
			changed = true;
		},
	};
});

layer(services, { excludeTestServices: true })((test) => {
	test.effect(
		"restarts awaiting approval, refuses stale/competing decisions, and dispatches once",
		() =>
			Effect.gen(function* () {
				const repository = yield* AssistantRepository;
				const setup = yield* harness();
				const payload = yield* admit();
				const engine = engineFor(setup.runtime);
				const executionId = yield* AssistantTurnWorkflow.executionId(payload);
				yield* Effect.gen(function* () {
					const service = yield* makeAssistantService(account);
					yield* service.recover();
					yield* until(
						repository
							.loadTurn(owner, payload.turnId)
							.pipe(Effect.map((state) => state?.turn.status === "awaiting-approval")),
					);

					yield* until(
						AssistantTurnWorkflow.poll(executionId).pipe(
							Effect.map((result) => Option.isSome(result) && result.value._tag === "Suspended"),
						),
					);
				}).pipe(withEngine(engine));
				expect(setup.writes).toEqual([]);
				const state = yield* repository.loadTurn(owner, payload.turnId);
				assert(state);
				const call = state.calls[0];
				assert(call);
				const decision = {
					toolCallId: call.call.id,
					decision: "approve" as const,
					expectedRevision: call.revision,
					turnId: AssistantTurnId.make(payload.turnId),
					conversationId: AssistantConversationId.make(state.turn.conversationId),
				};
				yield* Effect.gen(function* () {
					const service = yield* makeAssistantService(account);
					yield* service.decide(owner, decision);
					yield* service.decide(owner, decision);
					assertExitFails(
						yield* Effect.exit(service.decide(owner, { ...decision, decision: "decline" })),
						new AssistantError({ reason: { code: "decision-conflict" } }),
					);
					yield* until(
						repository
							.loadTurn(owner, payload.turnId)
							.pipe(Effect.map((current) => current?.turn.status === "completed")),
					);
				}).pipe(withEngine(engineFor(setup.runtime)));
				expect(setup.generated()).toBe(2);
				expect(setup.writes).toHaveLength(1);
				const finished = yield* repository.loadTurn(owner, payload.turnId);
				assert(finished);
				expect(
					finished.messages
						.flatMap((message) => message.parts)
						.filter((part) => part.kind === "page-preview"),
				).toEqual([{ kind: "page-preview", ...preview }]);
			}),
	);

	test.effect("stop wakes a turn awaiting approval and settles it without dispatching", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const setup = yield* harness();
			const payload = yield* admit();
			const executionId = yield* AssistantTurnWorkflow.executionId(payload);
			yield* Effect.gen(function* () {
				const service = yield* makeAssistantService(account);
				yield* service.recover();
				yield* until(
					AssistantTurnWorkflow.poll(executionId).pipe(
						Effect.map((result) => Option.isSome(result) && result.value._tag === "Suspended"),
					),
				);
				const state = yield* repository.loadTurn(owner, payload.turnId);
				assert(state);
				const stop = {
					turnId: AssistantTurnId.make(payload.turnId),
					conversationId: AssistantConversationId.make(state.turn.conversationId),
				};
				yield* service.interrupt(owner, stop);
				yield* until(
					AssistantTurnWorkflow.poll(executionId).pipe(
						Effect.map((result) => Option.isSome(result) && result.value._tag === "Complete"),
					),
				);
				expect(yield* Effect.flip(service.interrupt(owner, stop))).toEqual(
					new AssistantError({ reason: { code: "turn-not-active" } }),
				);
			}).pipe(withEngine(engineFor(setup.runtime)));
			const final = yield* repository.loadTurn(owner, payload.turnId);
			assert(final);
			expect(final.turn.status).toBe("interrupted");
			expect(final.calls.map((call) => call.result)).toEqual([
				{ truncated: false, value: { interrupted: true } },
			]);
			expect(setup.writes).toEqual([]);
			expect(setup.generated()).toBe(1);
		}),
	);

	test.effect("waits for answers to a question, keeps the plan and stops while waiting", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const localCalls = [
				{ name: "todo", arguments: { items: [{ content: "Pick a layout", status: "in_progress" }] } },
				{
					name: "question",
					arguments: { questions: [{ question: "Which layout?", options: ["Grid", "List"] }] },
				},
			];
			for (const stop of [false, true]) {
				const setup = yield* harness({ localCalls });
				const payload = yield* admit();
				const executionId = yield* AssistantTurnWorkflow.executionId(payload);
				yield* Effect.gen(function* () {
					const service = yield* makeAssistantService(account);
					yield* service.recover();
					yield* until(
						AssistantTurnWorkflow.poll(executionId).pipe(
							Effect.map((result) => Option.isSome(result) && result.value._tag === "Suspended"),
						),
					);
					const state = yield* repository.loadTurn(owner, payload.turnId);
					assert(state);
					expect(state.turn.status).toBe("awaiting-input");
					const question = state.calls.find(({ call }) => call.kind === "tool" && call.tool === "question");
					assert(question);
					const target = {
						toolCallId: question.call.id,
						turnId: AssistantTurnId.make(payload.turnId),
						conversationId: AssistantConversationId.make(state.turn.conversationId),
					};
					if (stop) {
						yield* service.interrupt(owner, target);
					} else {
						assertExitFails(
							yield* Effect.exit(service.answer(owner, { ...target, answers: ["Grid", "Extra"] })),
							new AssistantError({ reason: { code: "answer-invalid" } }),
						);
						yield* service.answer(owner, { ...target, answers: ["Grid"] });
						yield* service.answer(owner, { ...target, answers: ["Grid"] });
						assertExitFails(
							yield* Effect.exit(service.answer(owner, { ...target, answers: ["List"] })),
							new AssistantError({ reason: { code: "decision-conflict" } }),
						);
					}
					yield* until(
						AssistantTurnWorkflow.poll(executionId).pipe(
							Effect.map((result) => Option.isSome(result) && result.value._tag === "Complete"),
						),
					);
				}).pipe(withEngine(engineFor(setup.runtime)));
				const final = yield* repository.loadTurn(owner, payload.turnId);
				assert(final);
				expect(final.turn.status).toBe(stop ? "interrupted" : "completed");
				expect(final.calls.map(({ result }) => result)).toEqual([
					{ truncated: false, value: { updated: true } },
					{
						truncated: false,
						value: stop
							? { interrupted: true }
							: { answers: [{ question: "Which layout?", answer: "Grid" }] },
					},
				]);
				expect(setup.generated()).toBe(stop ? 1 : 2);
			}
		}),
	);

	test.effect("delivers a message sent mid-turn at the next step before completing", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const setup = yield* harness({ readOnly: true, callRounds: 0 });
			const payload = yield* admit();
			const conversationId = (yield* repository.loadTurn(owner, payload.turnId))?.turn
				.conversationId;
			assert(conversationId);
			setup.steerNext(conversationId, "Use a dark theme");
			yield* AssistantTurnWorkflow.execute(payload).pipe(withEngine(engineFor(setup.runtime)));
			const state = yield* repository.loadTurn(owner, payload.turnId);
			assert(state);
			expect(state.turn.status).toBe("completed");
			expect(setup.generated()).toBe(2);
			expect(
				state.messages.flatMap(({ role, parts }) =>
					parts.length === 0 ? [] : [[role, parts.map((part) => part.kind)]],
				),
			).toEqual([
				["user", ["text"]],
				["assistant", ["text"]],
				["user", ["text"]],
				["assistant", ["text"]],
			]);
			expect(stableStringify(setup.requests[1]?.prompt)).toContain("Use a dark theme");
			expect(stableStringify(setup.requests[0]?.prompt)).not.toContain("Use a dark theme");
		}),
	);

	test.effect("replays a queued message and turns undelivered ones into the next turn on stop", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const setup = yield* harness({ callRounds: 1 });
			const payload = yield* admit();
			const executionId = yield* AssistantTurnWorkflow.executionId(payload);
			yield* Effect.gen(function* () {
				const service = yield* makeAssistantService(account);
				yield* service.recover();
				yield* until(
					AssistantTurnWorkflow.poll(executionId).pipe(
						Effect.map((result) => Option.isSome(result) && result.value._tag === "Suspended"),
					),
				);
				const state = yield* repository.loadTurn(owner, payload.turnId);
				assert(state);
				const conversationId = AssistantConversationId.make(state.turn.conversationId);
				const queued = { conversationId, requestId: "queued", text: "Then add a chart" };
				const sent = yield* service.submit(owner, queued);
				expect(String(sent.turnId)).toBe(payload.turnId);
				expect(yield* service.submit(owner, queued)).toEqual(sent);
				expect(yield* Effect.flip(service.submit(owner, { ...queued, text: "Other" }))).toEqual(
					new AssistantError({ reason: { code: "request-conflict" } }),
				);
				yield* service.interrupt(owner, { conversationId, turnId: sent.turnId });
				yield* until(
					repository
						.loadTurn(owner, payload.turnId)
						.pipe(Effect.map((current) => current?.turn.status === "interrupted")),
				);
				yield* until(
					repository.recoverableTurns.pipe(
						Effect.map((active) => active.every((turn) => turn.conversationId !== conversationId)),
					),
				);
				const conversation = yield* (yield* DatabaseSession).run((db) =>
					db
						.select({ text: assistantTurn.text, status: assistantTurn.status })
						.from(assistantTurn)
						.where(eq(assistantTurn.conversationId, conversationId))
						.orderBy(asc(assistantTurn.createdAt)),
				);
				expect(conversation.map(({ text, status }) => [text, status])).toEqual([
					["Create a page", "interrupted"],
					["Then add a chart", "completed"],
				]);
			}).pipe(withEngine(engineFor(setup.runtime)));
			expect(setup.generated()).toBe(2);
		}),
	);

	test.effect("pauses execute at each write for approval and resumes the same execution", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			for (const decision of ["approve", "decline"] as const) {
				const setup = yield* harness({ gatedWrite: true });
				const payload = yield* admit();
				yield* Effect.gen(function* () {
					const service = yield* makeAssistantService(account);
					yield* service.recover();
					yield* until(
						repository
							.loadTurn(owner, payload.turnId)
							.pipe(Effect.map((state) => state?.turn.status === "awaiting-approval")),
					);
					const state = yield* repository.loadTurn(owner, payload.turnId);
					assert(state);
					const [parent, child] = state.calls;
					assert(parent?.call.kind === "tool" && child?.call.kind === "capability");
					expect(parent.call.requiresApproval).toBe(false);
					expect(child.call.parentId).toBe(parent.call.id);
					expect(child.call.capability).toEqual(writeCapability);
					expect(setup.writes).toEqual([]);
					yield* service.decide(owner, {
						decision,
						toolCallId: child.call.id,
						expectedRevision: child.revision,
						turnId: AssistantTurnId.make(payload.turnId),
						conversationId: AssistantConversationId.make(state.turn.conversationId),
					});
					yield* until(
						repository
							.loadTurn(owner, payload.turnId)
							.pipe(Effect.map((current) => current?.turn.status === "completed")),
					);
				}).pipe(withEngine(engineFor(setup.runtime)));
				const finished = yield* repository.loadTurn(owner, payload.turnId);
				assert(finished);
				const [parent, child] = finished.calls;
				expect(child?.result).toEqual({
					truncated: false,
					value: decision === "approve" ? { deleted: true } : { declined: true },
				});
				expect(parent?.result).toEqual({
					truncated: false,
					value:
						decision === "approve"
							? { deleted: true }
							: { refused: "The user declined this write" },
				});
				expect(setup.writes).toHaveLength(decision === "approve" ? 1 : 0);
				expect(setup.generated()).toBe(2);
			}
		}),
	);

	test.effect(
		"decline never dispatches and a changed approval requirement cannot use a prior approval",
		() =>
			Effect.gen(function* () {
				const repository = yield* AssistantRepository;
				const session = yield* DatabaseSession;
				for (const decision of ["decline", "approve"] as const) {
					const setup = yield* harness();
					const payload = yield* admit();
					const round = yield* setup.runtime.generate(payload, 1);
					yield* setup.runtime.recordRound(payload, 1, round);
					const state = yield* repository.loadTurn(owner, payload.turnId);
					assert(state);
					const call = state.calls[0];
					assert(call);
					yield* session.transaction(
						repository.decide(owner, {
							decision,
							toolCallId: call.id,
							turnId: payload.turnId,
							expectedRevision: call.revision,
							conversationId: state.turn.conversationId,
						}),
					);
					setup.changeDescriptor();
					yield* setup.runtime.dispatch(payload, call.id);
					expect(setup.invocations).toEqual([]);
					const result = yield* repository.loadTurn(owner, payload.turnId);
					assert(result);
					expect(result.calls[0]?.result).toEqual(
						decision === "decline"
							? { truncated: false, value: { declined: true } }
							: {
									truncated: false,
									value: {
										error: "tool-failed",
										message: "The tool's approval requirement changed",
										instruction:
											"The call was refused or failed. Correct it or ask for approval again if needed.",
									},
								},
					);
				}
			}),
	);

	test.effect("replays after an owner write commits without duplicating writes or text", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const setup = yield* harness({ readOnly: true, interruptAfterWrite: true });
			const payload = yield* admit();
			const result = yield* setup.runtime.generate(payload, 1);
			yield* setup.runtime.generate(payload, 1);
			const state = yield* repository.loadTurn(owner, payload.turnId);
			assert(state);
			expect(
				state.messages.filter((message) => message.id === `${payload.turnId}:round:1:text`),
			).toHaveLength(1);
			yield* setup.runtime.recordRound(payload, 1, result);
			const call = result.calls[0];
			assert(call);
			expect(Exit.isFailure(yield* Effect.exit(setup.runtime.dispatch(payload, call.id)))).toBe(
				true,
			);
			yield* setup.runtime.dispatch(payload, call.id);
			yield* setup.runtime.dispatch(payload, call.id);
			expect(setup.writes).toHaveLength(1);
			expect(setup.invocations).toHaveLength(2);
			expect(setup.invocations[0]).toBe(setup.invocations[1]);
		}),
	);

	test.effect("runs until the model stops calling tools and records failures without prose", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const cases: readonly (readonly [
				NonNullable<Parameters<typeof harness>[0]>,
				"completed" | AssistantTurnFailure["code"],
			])[] = [
				[{ readOnly: true, callRounds: 20 }, "completed"],
				[{ failProvider: "provider-failed" }, "provider-failed"],
				[{ failProvider: "context-overflow" }, "request-limit"],
				[{ noProvider: true }, "provider-unavailable"],
			];
			for (const [options, outcome] of cases) {
				const setup = yield* harness(options);
				const payload = yield* admit();
				yield* AssistantTurnWorkflow.execute(payload).pipe(withEngine(engineFor(setup.runtime)));
				const state = yield* repository.loadTurn(owner, payload.turnId);
				assert(state);
				if (outcome === "completed") {
					expect(state.turn.status).toBe("completed");
					expect(setup.generated()).toBe(21);
				} else {
					expect(state.turn.status).toBe("failed");
					expect(state.turn.failure).toEqual({ code: outcome });
				}
			}
		}),
	);

	test.effect("continues a reply that reached the output limit", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const setup = yield* harness({ callRounds: 0, readOnly: true, cutFirstReply: true });
			const payload = yield* admit();
			yield* AssistantTurnWorkflow.execute(payload).pipe(withEngine(engineFor(setup.runtime)));
			const state = yield* repository.loadTurn(owner, payload.turnId);
			assert(state);
			expect(state.turn.status).toBe("completed");
			expect(setup.generated()).toBe(2);
			expect(
				state.messages.flatMap((message) =>
					message.parts.flatMap((part) => (part.kind === "instruction" ? [message.role] : [])),
				),
			).toEqual(["user"]);
			expect(stableStringify(setup.requests[1]?.prompt)).toContain("reached the output limit");
		}),
	);

	test.effect("stores oversized tool output, previews it and reads it back", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const setup = yield* harness({
				readOnly: true,
				resultBytes: 120_000,
				readStoredResult: true,
			});
			const payload = yield* admit();
			yield* AssistantTurnWorkflow.execute(payload).pipe(withEngine(engineFor(setup.runtime)));
			const state = yield* repository.loadTurn(owner, payload.turnId);
			assert(state);
			expect(state.turn.status).toBe("completed");
			const [stored, read] = state.calls;
			assert(stored?.result && read?.result);
			expect(stored.result).toMatchObject({
				lines: 12_000,
				outputId: stored.id,
				truncated: "retained",
			});
			expect(read.result).toEqual({
				truncated: false,
				value: {
					endLine: 2_001,
					startLine: 2_000,
					totalLines: 12_000,
					text: "2000: line 1999\n2001: line 2000",
				},
			});
			const prompt = stableStringify(setup.requests[1]?.prompt);
			expect(prompt).toContain(`outputId: \\"${stored.id}\\"`);
			expect(prompt).not.toContain("line 6000");
		}),
	);

	test.effect("compacts older history before the context window fills, and on overflow", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			for (const options of [
				{ callRounds: 6, readOnly: true, resultBytes: 30_000, contextWindow: 40_000 },
				{ callRounds: 3, readOnly: true, overflowRound: 3 },
			]) {
				const setup = yield* harness(options);
				const payload = yield* admit();
				yield* AssistantTurnWorkflow.execute(payload).pipe(withEngine(engineFor(setup.runtime)));
				const state = yield* repository.loadTurn(owner, payload.turnId);
				assert(state);
				expect(state.turn.status).toBe("completed");
				expect(setup.summaries()).toBeGreaterThan(0);
				expect(
					state.messages.some((message) =>
						message.parts.some((part) => part.kind === "compaction"),
					),
				).toBe(true);
				expect(stableStringify(setup.requests.at(-1)?.prompt)).toContain("<conversation-summary>");
				expect(state.calls.every((call) => call.result !== null)).toBe(true);
			}
		}),
	);

	test.effect("stores a round's reasoning with the tool calls it produced", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const setup = yield* harness({ readOnly: true, reasoning: true });
			const payload = yield* admit();
			const round = yield* setup.runtime.generate(payload, 1);
			yield* setup.runtime.recordRound(payload, 1, round);
			const state = yield* repository.loadTurn(owner, payload.turnId);
			assert(state);
			const message = state.messages.find((candidate) =>
				candidate.parts.some((part) => part.kind === "tool-call"),
			);
			assert(message);
			expect(message.parts.filter((part) => part.kind === "reasoning")).toEqual([
				{ kind: "reasoning", field: "reasoning", text: "Need a page." },
			]);
		}),
	);

	test.effect("returns invalid tool arguments to the model instead of failing the turn", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const setup = yield* harness({ invalidArguments: true });
			const payload = yield* admit();
			yield* AssistantTurnWorkflow.execute(payload).pipe(withEngine(engineFor(setup.runtime)));
			const state = yield* repository.loadTurn(owner, payload.turnId);
			assert(state);
			expect(state.turn.status).toBe("completed");
			expect(setup.generated()).toBe(2);
			expect(setup.invocations).toEqual([]);
			const [call] = state.calls;
			assert(call);
			expect(call.decision).toBeNull();
			expect(call.call.requiresApproval).toBe(false);
			assert(call.result && !call.result.truncated);
			expect(call.result.value).toMatchObject({
				error: "tool-failed",
				message: 'Expected string at ["query"]',
			});
		}),
	);

	test.effect(
		"retains bounded compiler diagnostics for repair and rechecks lifecycle before dispatch",
		() =>
			Effect.gen(function* () {
				const repository = yield* AssistantRepository;
				const setup = yield* harness({ readOnly: true, failBuild: true });
				const payload = yield* admit();
				const result = yield* setup.runtime.generate(payload, 1);
				yield* setup.runtime.recordRound(payload, 1, result);
				const call = result.calls[0];
				assert(call);
				yield* setup.runtime.dispatch(payload, call.id);
				const state = yield* repository.loadTurn(owner, payload.turnId);
				assert(state);
				expect(stableStringify(state.calls[0]?.result)).toContain("TS2304");
				setup.retire();
				assertExitFails(
					yield* Effect.exit(setup.runtime.dispatch(payload, call.id)),
					new AuthUnauthorized({ reason: { code: "authentication-required" } }),
				);
			}),
	);

	test.effect("demo approval is refused before a decision is persisted", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const setup = yield* harness();
			const payload = yield* admit();
			const result = yield* setup.runtime.generate(payload, 1);
			yield* setup.runtime.recordRound(payload, 1, result);
			const state = yield* repository.loadTurn(owner, payload.turnId);
			assert(state);
			const call = state.calls[0];
			assert(call);
			yield* Effect.gen(function* () {
				const service = yield* makeAssistantService(() =>
					Effect.succeed({ authorization: { accessClass: "demo", writeAccess: "confirm" } }),
				);
				assertExitFails(
					yield* Effect.exit(
						service.decide(owner, {
							decision: "approve",
							toolCallId: call.call.id,
							expectedRevision: call.revision,
							turnId: AssistantTurnId.make(payload.turnId),
							conversationId: AssistantConversationId.make(state.turn.conversationId),
						}),
					),
					new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
				);
			}).pipe(withEngine(engineFor(setup.runtime)));
			expect((yield* repository.loadTurn(owner, payload.turnId))?.calls[0]?.decision).toBeNull();
		}),
	);

	test.effect(
		"Save fences preview ownership and draft identity, and retries publication/view creation",
		() =>
			Effect.gen(function* () {
				const repository = yield* AssistantRepository;
				const setup = yield* harness({ readOnly: true });
				const payload = yield* admit();
				const result = yield* setup.runtime.generate(payload, 1);
				yield* setup.runtime.recordRound(payload, 1, result);
				const call = result.calls[0];
				assert(call);
				yield* setup.runtime.dispatch(payload, call.id);
				const state = yield* repository.loadTurn(owner, payload.turnId);
				assert(state);
				const input = {
					...preview,
					name: "Page",
					slug: "page",
					icon: "file",
					requestId: "save",
					turnId: AssistantTurnId.make(payload.turnId),
					conversationId: AssistantConversationId.make(state.turn.conversationId),
				};
				const publications: string[] = [];
				const savedViews: string[] = [];
				let failed = false;
				let interruptedView = false;
				let currentDraftRevision = preview.draftRevision;
				const receipts = new Map<string, { id: SavedViewId }>();
				const save = yield* makeAssistantSavePage({
					resolveAccount: (userId) =>
						Effect.succeed({
							user: { id: userId },
							authorization: { writeAccess: "confirm", accessClass: "standard" },
						}),
					pages: {
						publishCompiledDraft: (_userId, _input, key) =>
							Effect.sync(() => {
								assert(key);
								if (!publications.includes(key)) {
									if (currentDraftRevision !== _input.draftRevision) {
										return null;
									}
									publications.push(key);
								}
								return preview;
							}),
					},
					views: {
						create: (_user, _input, _trusted, key) =>
							Effect.gen(function* () {
								assert(key);
								if (!failed) {
									failed = true;
									return yield* new DbError({ message: "process stopped after publish" });
								}
								const existing = receipts.get(key);
								if (existing) {
									return existing;
								}
								savedViews.push(key);
								const view = { id: SavedViewId.make("saved-view") };
								receipts.set(key, view);
								if (!interruptedView) {
									interruptedView = true;
									return yield* Effect.interrupt;
								}
								return view;
							}),
					},
				});
				assertExitFails(
					yield* Effect.exit(save.save(other, input)),
					new AssistantError({ reason: { code: "page-preview-not-found" } }),
				);
				assertExitFails(
					yield* Effect.exit(
						save.save(owner, { ...input, artifactHash: "changed", requestId: "wrong-draft" }),
					),
					new AssistantError({ reason: { code: "page-preview-not-found" } }),
				);
				currentDraftRevision += 1;
				assertExitFails(
					yield* Effect.exit(save.save(owner, { ...input, requestId: "stale-draft" })),
					new AssistantError({ reason: { code: "page-preview-not-found" } }),
				);
				currentDraftRevision = preview.draftRevision;
				assertExitFails(
					yield* Effect.exit(save.save(owner, input)),
					new DbError({ message: "process stopped after publish" }),
				);
				currentDraftRevision += 1;
				assertExitFails(
					yield* Effect.exit(save.save(owner, { ...input, name: "Changed" })),
					new AssistantError({ reason: { code: "request-conflict" } }),
				);
				expect(Exit.isFailure(yield* Effect.exit(save.save(owner, input)))).toBe(true);
				currentDraftRevision += 1;
				expect(yield* save.save(owner, input)).toEqual({
					pageId: preview.pageId,
					savedViewId: SavedViewId.make("saved-view"),
				});
				currentDraftRevision += 1;
				expect(yield* save.save(owner, input)).toEqual({
					pageId: preview.pageId,
					savedViewId: SavedViewId.make("saved-view"),
				});
				expect(publications).toHaveLength(1);
				expect(savedViews).toHaveLength(1);
				assertExitFails(
					yield* Effect.exit(save.save(owner, { ...input, name: "Changed" })),
					new AssistantError({ reason: { code: "request-conflict" } }),
				);
			}),
	);
	test.effect("recovers a committed approval without its wake", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const session = yield* DatabaseSession;
			const setup = yield* harness();
			const payload = yield* admit();
			const round = yield* setup.runtime.generate(payload, 1);
			yield* setup.runtime.recordRound(payload, 1, round);
			const waiting = yield* repository.loadTurn(owner, payload.turnId);
			assert(waiting);
			const call = waiting.calls[0];
			assert(call);
			yield* session.transaction(
				repository.decide(owner, {
					toolCallId: call.id,
					decision: "approve",
					turnId: payload.turnId,
					expectedRevision: call.revision,
					conversationId: waiting.turn.conversationId,
				}),
			);
			yield* Effect.gen(function* () {
				const service = yield* makeAssistantService(account);
				yield* service.recover();
				yield* until(
					repository
						.loadTurn(owner, payload.turnId)
						.pipe(Effect.map((state) => state?.turn.status === "completed")),
				);
			}).pipe(withEngine(engineFor(setup.runtime)));
			expect(setup.writes).toHaveLength(1);
			const state = yield* repository.loadTurn(owner, payload.turnId);
			assert(state);
		}),
	);
	test.effect("account reset removes conversations, active histories and provider overrides", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			const providers = yield* AssistantProviderRepository;
			const lifecycle = yield* UserLifecycleRepository;
			const session = yield* DatabaseSession;
			const victim = UserId.make("assistant-reset-owner");
			yield* session.run((db) =>
				db
					.insert(user)
					.values({ id: victim, name: "Reset", email: "assistant-reset@example.test" }),
			);
			const turn = yield* session.transaction(
				Effect.gen(function* () {
					yield* providers.put(victim, {
						model: "test",
						encryptedApiKey: null,
						baseUrl: "https://provider.test/v1",
					});
					return yield* repository.submit(victim, { text: "Read data", requestId: "reset" });
				}),
			);
			yield* lifecycle.deleteUserData(victim);
			expect(yield* repository.loadTurn(victim, turn.id)).toBeNull();
			expect(yield* providers.find(victim)).toBeNull();
			expect((yield* repository.recoverableTurns).some((active) => active.userId === victim)).toBe(
				false,
			);
		}),
	);
	test.effect(
		"registers before recovery and immediately replays duplicate submits on that engine",
		() =>
			Effect.gen(function* () {
				const repository = yield* AssistantRepository;
				const setup = yield* harness({ readOnly: true });
				yield* Effect.gen(function* () {
					const service = yield* makeAssistantService(account);
					yield* Effect.scoped(
						Layer.build(
							AssistantRecoveryLive.pipe(Layer.provide(Layer.succeed(AssistantService, service))),
						),
					);
					const request = { text: "Read data", requestId: "same-request" };
					const submitted = yield* service.submit(owner, request);
					expect(yield* service.submit(owner, request)).toEqual(submitted);
					yield* service.recover();
					yield* until(
						repository
							.loadTurn(owner, submitted.turnId)
							.pipe(Effect.map((state) => state?.turn.status === "completed")),
					);
					expect(setup.writes).toHaveLength(1);
					expect(setup.generated()).toBe(2);
				}).pipe(withEngine(engineFor(setup.runtime)));
			}),
	);
});
