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
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Exit, Layer, Option, Schedule, Stream } from "effect";

import { UserLifecycleRepository } from "#modules/accounts/lifecycle/repository";
import type { AgentToolOutcome } from "#modules/agent-tools/service";
import { idempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";
import { AgentRunSuspended } from "#modules/scripts/agent/service";
import { DatabaseSession } from "#platform/db/session";
import { truncateJsonResult } from "#platform/tool-result";
import { PostgresWorkflowEngine } from "#platform/workflow/engine";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { user } from "#schema/tables/auth";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { assistantContext } from "./context";
import { AssistantRecoveryLive } from "./layer";
import { AssistantModelError, type AssistantModelEvent } from "./provider-model";
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
const account = () => Effect.succeed({ authorization: { accessClass: "standard" as const } });
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
const admit = Effect.fn(function* () {
	const repository = yield* AssistantRepository;
	const session = yield* DatabaseSession;
	const { conversationId } = yield* session.transaction(
		repository.createConversation(owner, "Assistant"),
	);
	const turn = yield* session.transaction(
		repository.submit(owner, { conversationId, requestId: "request", text: "Create a page" }),
	);
	return { userId: owner, turnId: turn.id };
});
const harness = Effect.fn(function* (
	options: {
		readonly readOnly?: boolean;
		readonly failBuild?: boolean;
		readonly reasoning?: boolean;
		readonly alwaysCall?: boolean;
		readonly noProvider?: boolean;
		readonly gatedWrite?: boolean;
		readonly failProvider?: boolean;
		readonly invalidArguments?: boolean;
		readonly interruptAfterWrite?: boolean;
	} = {},
) {
	const session = yield* DatabaseSession;
	const keys = yield* IdempotencyKeys;
	const writes: string[] = [];
	const invocations: string[] = [];
	let generated = 0;
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
								baseUrl: "https://provider.test/v1",
							},
				),
		},
		model: {
			stream: () => {
				generated += 1;
				if (options.failProvider) {
					return Stream.fail(new AssistantModelError({ code: "provider-failed" }));
				}
				const events: AssistantModelEvent[] = [{ type: "text-delta", text: "x".repeat(600) }];
				if (options.reasoning) {
					events.push(
						{ text: "Need ", field: "reasoning", type: "reasoning-delta" },
						{ text: "a page.", field: "reasoning", type: "reasoning-delta" },
					);
				}
				if (generated === 1 || options.alwaysCall) {
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
					if (options.failBuild) {
						return {
							state: "completed",
							result: truncateJsonResult({ code: "TS2304", error: "build-failed" }),
						} satisfies AgentToolOutcome;
					}
					if (options.gatedWrite) {
						const write = { index: 0, input: { pageId: "page" }, capability: writeCapability };
						const decision = yield* input.gate
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
						yield* input.gate.settle(write, { state: "success", value: { deleted: true } });
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
		invocations,
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

	test.effect("bounds model rounds and records provider failures without diagnostic prose", () =>
		Effect.gen(function* () {
			const repository = yield* AssistantRepository;
			for (const options of [
				{ readOnly: true, alwaysCall: true },
				{ failProvider: true },
				{ noProvider: true },
			]) {
				const setup = yield* harness(options);
				const payload = yield* admit();
				yield* AssistantTurnWorkflow.execute(payload).pipe(withEngine(engineFor(setup.runtime)));
				const state = yield* repository.loadTurn(owner, payload.turnId);
				assert(state);
				expect(state.turn.status).toBe("failed");
				let code: AssistantTurnFailure["code"] = "provider-failed";
				if (options.alwaysCall) {
					code = "round-limit";
				}
				if (options.noProvider) {
					code = "provider-unavailable";
				}
				expect(state.turn.failure).toEqual({ code });
				if (options.alwaysCall) {
					expect(setup.generated()).toBe(12);
				}
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
					Effect.succeed({ authorization: { accessClass: "demo" } }),
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
						Effect.succeed({ user: { id: userId }, authorization: { accessClass: "standard" } }),
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
	test.effect(
		"recovers a committed approval without its wake and retains paired bounded context",
		() =>
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
				const history = [
					{ role: "user" as const, parts: [{ kind: "text" as const, text: "x".repeat(16_000) }] },
					...state.messages,
				];
				const bounded = assistantContext(history, 8_000);
				expect(
					bounded
						.flatMap((message) => message.parts)
						.filter((part) => part.kind === "tool-call" || part.kind === "tool-result"),
				).toHaveLength(2);
				const tiny = assistantContext(state.messages, 1);
				expect(tiny).toEqual([]);
				expect(history.length).toBeGreaterThan(bounded.length);
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
					const conversation = yield* repository.createConversation(victim, "Reset");
					yield* providers.put(victim, {
						model: "test",
						encryptedApiKey: null,
						baseUrl: "https://provider.test/v1",
					});
					return yield* repository.submit(victim, {
						...conversation,
						text: "Read data",
						requestId: "reset",
					});
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
					const conversation = yield* service.createConversation(owner, "Startup");
					const request = { ...conversation, text: "Read data", requestId: "same-request" };
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
