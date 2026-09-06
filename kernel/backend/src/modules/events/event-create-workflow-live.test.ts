import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationPolicyOutput,
	AutomationRun,
	type AutomationRequestPayload,
	type AutomationTrigger,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationHookSlug,
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Exit, Layer, Ref, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";

import {
	LifecyclePlanner,
	lifecycleRunId,
	type LifecyclePlannedPolicy,
} from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import {
	AutomationPolicyExecutionError,
	LifecycleExecution,
} from "#lib/domain/lifecycle-execution";
import { applyLifecyclePolicyPatches } from "#lib/domain/lifecycle-policy-patch";
import { user } from "#lib/infrastructure/db/schema/tables/auth";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

import { EventCreateWorkflow, type EventCreateWorkflowPayload } from "./event-create-workflow";
import { runEventCreateWorkflow } from "./event-create-workflow-live";
import { EventsRepository } from "./repository";

const now = IsoUtcString.make("2026-01-01T00:00:00.000Z");
const userId = UserId.make("user");
const entityId = EntityId.make("subject");
const eventSchemaSlug = EventSchemaSlug.make("rating");
const entitySchemaSlug = EntitySchemaSlug.make("record");
const command = rootLifecycleCommand({
	source: "api",
	occurredAt: now,
	itemIdentity: "events",
	initiator: { id: userId, kind: "user" },
	executionId: AutomationExecutionId.make("batch"),
	accountGeneration: { userId, token: "test-account-generation" },
});
const payload: EventCreateWorkflowPayload = {
	userId,
	command,
	payload: [{ entityId, eventSchemaSlug, properties: { rating: 1 } }],
};
type Policy = {
	slug: string;
	plugin?: string;
	position: number;
	frequency?: LifecyclePlannedPolicy["batchFrequency"];
};

type HarnessOptions = {
	unreadableEntity?: EntityId;
	revokeEntityBeforeWrite?: EntityId;
	policies?: Policy[];
	execute?: (
		input: Parameters<LifecycleExecution["Service"]["executePolicy"]>[0] & {
			payload: AutomationRequestPayload;
			index: number;
		},
	) => Effect.Effect<AutomationPolicyOutput, AutomationPolicyExecutionError>;
	blocked?: "request" | "change";
	warnings?: AutomationWarning[];
	failChange?: boolean;
	activateSchemaBeforeWrite?: boolean;
	replayWriteAfterSchemaDisable?: boolean;
};

type CreatedEvent = Parameters<EventsRepository["Service"]["createEvent"]>[0];

type HarnessState = {
	readonly options: HarnessOptions;
	readonly calls: ReadonlyArray<string>;
	readonly triggers: ReadonlyArray<AutomationTrigger>;
	readonly created: ReadonlyArray<CreatedEvent>;
	readonly inputs: ReadonlyArray<AutomationRequestPayload>;
	readonly exclusions: ReadonlyArray<unknown>;
	readonly queued: ReadonlySet<string>;
	readonly identities: ReadonlyMap<string, string>;
	readonly policyRequests: ReadonlyMap<string, AutomationRequestPayload>;
	readonly executed: ReadonlyArray<string>;
	readonly lockedEntityIds: ReadonlyArray<ReadonlyArray<EntityId>>;
	readonly activeTransaction: boolean;
	readonly activeActivity: boolean;
	readonly schemaActivated: boolean;
	readonly schemaDisabled: boolean;
};

const initialState = (options: HarnessOptions): HarnessState => ({
	options,
	calls: [],
	inputs: [],
	created: [],
	triggers: [],
	executed: [],
	exclusions: [],
	queued: new Set(),
	lockedEntityIds: [],
	identities: new Map(),
	activeActivity: false,
	schemaDisabled: false,
	schemaActivated: false,
	activeTransaction: false,
	policyRequests: new Map(),
});

class EventCreateHarness extends Context.Service<
	EventCreateHarness,
	{
		readonly calls: Effect.Effect<ReadonlyArray<string>>;
		readonly triggers: Effect.Effect<ReadonlyArray<AutomationTrigger>>;
		readonly created: Effect.Effect<ReadonlyArray<CreatedEvent>>;
		readonly inputs: Effect.Effect<ReadonlyArray<AutomationRequestPayload>>;
		readonly exclusions: Effect.Effect<ReadonlyArray<unknown>>;
		readonly queued: Effect.Effect<ReadonlySet<string>>;
		readonly executed: Effect.Effect<ReadonlyArray<string>>;
		readonly lockedEntityIds: Effect.Effect<ReadonlyArray<ReadonlyArray<EntityId>>>;
		readonly reset: (options: HarnessOptions) => Effect.Effect<void>;
	}
>()("test/EventCreateHarness") {}

const harnessLayer = (initialOptions: HarnessOptions = {}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const state = yield* Ref.make(initialState(initialOptions));
			const current = Ref.get(state);
			const read = <A>(select: (snapshot: HarnessState) => A) => Effect.map(current, select);
			const update = (change: (snapshot: HarnessState) => Partial<HarnessState>) =>
				Ref.update(state, (snapshot) => ({ ...snapshot, ...change(snapshot) }));
			const record = (call: string) => update(({ calls }) => ({ calls: [...calls, call] }));
			const database = Layer.effect(
				DatabaseSession,
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					yield* session.run((db) =>
						db
							.insert(user)
							.values({
								id: userId,
								name: "User",
								email: "event-workflow@example.test",
								accountGeneration: "test-account-generation",
							}),
					);
					return DatabaseSession.of({
						...session,
						transaction: (work) =>
							Effect.gen(function* () {
								const before = yield* current;
								expect(before.activeTransaction).toBe(false);
								const saved = { created: before.created.length, triggers: before.triggers.length };
								if (!before.activeActivity) {
									return yield* session.transaction(work).pipe(
										Effect.tap(() =>
											Effect.gen(function* () {
												const after = yield* current;
												expect(after.created).toHaveLength(saved.created);
												expect(after.triggers).toHaveLength(saved.triggers);
											}),
										),
									);
								}
								yield* update(({ calls }) => ({
									activeTransaction: true,
									calls: [...calls, "begin"],
								}));
								return yield* session.transaction(work).pipe(
									Effect.tapError(() =>
										update(({ calls, created, triggers }) => ({
											calls: [...calls, "rollback"],
											created: created.slice(0, saved.created),
											triggers: triggers.slice(0, saved.triggers),
										})),
									),
									Effect.tap(() => record("commit")),
									Effect.ensuring(update(() => ({ activeTransaction: false }))),
								);
							}),
					});
				}),
			).pipe(Layer.provide(isolatedDatabaseLayer("event_create_workflow")));
			const planner = Layer.effect(
				LifecyclePlanner,
				Effect.map(DatabaseSession, (session) =>
					LifecyclePlanner.of(
						withLifecycleBatchPlanning({
							plan: (input) =>
								Effect.gen(function* () {
									const { options, triggers, activeTransaction } = yield* current;
									expect(activeTransaction).toBe(true);
									expect(yield* (yield* DatabaseSession).isTransactionActive).toBe(true);
									const trigger = input.trigger;
									const existing = triggers.find(({ id }) => id === trigger.id);
									if (existing) {
										if (!Bun.deepEquals(existing, trigger)) {
											return yield* new DbError({
												message: "Automation trigger identity conflict",
											});
										}
										yield* record(`plan:${trigger.kind.category}`);
										return { runs: [], policies: [], trigger: existing, wasCreated: false };
									}
									if (trigger.kind.category === "change" && options.failChange) {
										return yield* new DbError({ message: "planning failed" });
									}
									yield* update(({ calls, triggers: planned }) => ({
										triggers: [...planned, trigger],
										calls: [...calls, `plan:${trigger.kind.category}`],
									}));
									if (trigger.kind.category === options.blocked) {
										return {
											runs: [],
											policies: [],
											wasCreated: true,
											trigger: {
												...trigger,
												blockedReason: {
													code: "automation-limit-reached" as const,
													hasRequiredHooks: trigger.kind.category === "change",
													omittedHooks: [
														{
															pluginId: PluginId.make("plugin"),
															hookSlug: AutomationHookSlug.make("hook"),
														},
													],
												},
											},
										};
									}
									if (trigger.kind.category !== "request") {
										return { trigger, runs: [], policies: [], wasCreated: true };
									}
									yield* update(({ exclusions }) => ({
										exclusions: [...exclusions, input.excludedOncePerSubjectPolicies],
									}));
									const declarations = (options.policies ?? []).filter(
										(policy) =>
											policy.frequency !== "once-per-subject" ||
											!input.excludedOncePerSubjectPolicies?.some(
												(excluded) =>
													excluded.pluginId === (policy.plugin ?? "plugin") &&
													excluded.hookSlug === policy.slug,
											),
									);
									const runs = declarations.map((policy) => {
										const pluginId = PluginId.make(policy.plugin ?? "plugin");
										const hookSlug = AutomationHookSlug.make(policy.slug);
										return Schema.decodeSync(AutomationRun)({
											pluginId,
											hookSlug,
											queuedAt: now,
											stage: "before",
											attemptCount: 0,
											startedAt: null,
											status: "queued",
											skipReason: null,
											finishedAt: null,
											retryPolicy: null,
											delivery: "policy",
											nextAttemptAt: null,
											scriptSlug: "script",
											triggerId: trigger.id,
											hookName: policy.slug,
											artifactsExpireAt: now,
											executionUserId: userId,
											sandboxScriptId: "script",
											scriptContentHash: "hash",
											pluginRevisionId: "revision",
											pluginConfigRevisionId: "config",
											id: lifecycleRunId({
												pluginId,
												hookSlug,
												triggerId: trigger.id,
												executionUserId: userId,
											}),
										});
									});
									const requestPayload = trigger.payload;
									yield* update(({ queued, identities, policyRequests }) => ({
										queued: new Set([...queued, ...runs.map((run) => run.id)]),
										identities: new Map([
											...identities,
											...runs.map((run) => [run.id, `${run.pluginId}/${run.hookSlug}`] as const),
										]),
										policyRequests:
											requestPayload?.category === "request"
												? new Map([
														...policyRequests,
														...runs.map((run) => [run.id, requestPayload] as const),
													])
												: policyRequests,
									}));
									assert(
										trigger.payload?.category === "request" && trigger.payload.resource === "event",
									);
									return {
										runs,
										wasCreated: true,
										policies: runs.map((run, index) => ({
											runId: run.id,
											batchFrequency: declarations[index]?.frequency,
											position: declarations[index]?.position ?? 1000,
										})),
										trigger: {
											...trigger,
											payload: {
												...trigger.payload,
												excludedOncePerSubjectPolicies: input.excludedOncePerSubjectPolicies ?? [],
											},
										},
									};
								}).pipe(Effect.provideService(DatabaseSession, session)),
						}),
					),
				),
			);
			const execution = withLifecycleDispatch({
				skipQueuedPolicies: () =>
					Effect.gen(function* () {
						expect((yield* current).activeTransaction).toBe(false);
						yield* update(({ calls }) => ({ queued: new Set(), calls: [...calls, "skip"] }));
					}),
				after: () =>
					Effect.gen(function* () {
						const { options, activeActivity, activeTransaction } = yield* current;
						expect(activeTransaction).toBe(false);
						expect(activeActivity).toBe(false);
						yield* record("after");
						return options.warnings ?? [];
					}),
				executePolicy: (input) =>
					Effect.gen(function* () {
						const {
							options,
							executed,
							identities,
							activeActivity,
							policyRequests,
							activeTransaction,
						} = yield* current;
						expect(activeTransaction).toBe(false);
						expect(activeActivity).toBe(false);
						const retained = policyRequests.get(input.runId);
						assert(retained?.category === "request");
						const patched = applyLifecyclePolicyPatches(retained, input.acceptedPatches);
						assert(patched.ok);
						yield* update(({ calls, inputs, queued, executed: done }) => ({
							calls: [...calls, "policy"],
							inputs: [...inputs, patched.request],
							executed: [...done, identities.get(input.runId) ?? "missing"],
							queued: new Set([...queued].filter((id) => id !== input.runId)),
						}));
						return yield* (
							options.execute?.({ ...input, index: executed.length, payload: patched.request }) ??
								Effect.succeed({ action: "allow" as const })
						);
					}),
			});
			const engine = makeWorkflowEngine({
				activityExecute: (activity) =>
					Effect.gen(function* () {
						yield* update(() => ({ activeActivity: true }));
						let exit = yield* Effect.exit(activity.execute);
						if (
							(yield* current).options.replayWriteAfterSchemaDisable &&
							activity.name === "write-event-0" &&
							Exit.isSuccess(exit)
						) {
							yield* update(() => ({ schemaDisabled: true }));
							exit = yield* Effect.exit(activity.execute);
						}
						return new Workflow.Complete({ exit });
					}).pipe(Effect.ensuring(update(() => ({ activeActivity: false })))),
			});
			return Layer.mergeAll(
				database,
				planner.pipe(Layer.provide(database)),
				Layer.succeed(LifecycleExecution, execution),
				Layer.succeed(WorkflowEngine, engine),
				Layer.mock(EntitiesRepository)({
					lockEntityReferencesByIds: (entityIds) =>
						Effect.gen(function* () {
							expect((yield* current).activeTransaction).toBe(true);
							yield* update(({ lockedEntityIds }) => ({
								lockedEntityIds: [...lockedEntityIds, [...entityIds]],
							}));
						}),
					getEntityScopeForUser: ({ entityId: requestedId }) =>
						read(({ options, lockedEntityIds }) =>
							requestedId === options.unreadableEntity ||
							(lockedEntityIds.length > 0 && requestedId === options.revokeEntityBeforeWrite)
								? null
								: {
										entitySchemaSlug,
										isBuiltin: false,
										entityName: "Record",
										entityUserId: userId,
										entityId: requestedId,
										entitySchemaPluginId: null,
										propertiesSchema: { fields: {} },
									},
						),
				}),
				Layer.mock(EventSchemasRepository)({
					lockCatalog: () =>
						update(({ options }) => ({
							schemaActivated: options.activateSchemaBeforeWrite ?? false,
						})),
					getScopeForUser: () =>
						read(({ schemaDisabled, schemaActivated }) =>
							schemaDisabled
								? null
								: {
										name: "Rating",
										slug: "rating",
										eventSchemaSlug,
										entitySchemaSlug,
										id: eventSchemaSlug,
										propertiesSchema: {
											fields: {
												rating: schemaActivated
													? {
															label: "Rating",
															description: "Rating",
															type: "string" as const,
															validation: { required: true },
														}
													: {
															label: "Rating",
															description: "Rating",
															type: "number" as const,
															validation: { required: true },
															normalize: { round: { scale: 2 } },
														},
											},
										},
									},
						),
				}),
				Layer.mock(EventsRepository)({
					createEvent: (input) =>
						Effect.gen(function* () {
							const { activeActivity, activeTransaction } = yield* current;
							expect(activeTransaction).toBe(true);
							expect(activeActivity).toBe(true);
							yield* update(({ calls, created }) => ({
								calls: [...calls, "write"],
								created: [...created, input],
							}));
							return {
								id: input.id,
								createdAt: now,
								updatedAt: now,
								entityId: input.entityId,
								properties: input.properties,
								eventSchemaSlug: input.eventSchemaSlug,
								eventSchemaName: input.eventSchemaName,
								sessionEntityId: input.sessionEntityId,
								occurredAt: input.occurredAt.toISOString(),
							};
						}),
				}),
				Layer.succeed(EventCreateHarness, {
					calls: read(({ calls }) => calls),
					inputs: read(({ inputs }) => inputs),
					queued: read(({ queued }) => queued),
					created: read(({ created }) => created),
					triggers: read(({ triggers }) => triggers),
					executed: read(({ executed }) => executed),
					exclusions: read(({ exclusions }) => exclusions),
					reset: (options) => Ref.set(state, initialState(options)),
					lockedEntityIds: read(({ lockedEntityIds }) => lockedEntityIds),
				}),
			);
		}),
	);

const run = (input = payload) =>
	runEventCreateWorkflow(input, "workflow").pipe(
		Effect.provideService(
			WorkflowInstance,
			WorkflowInstance.initial(EventCreateWorkflow, "workflow"),
		),
	);

layer(harnessLayer())((test) => {
	test.effect(
		"plans before sandboxes, commits the exact event and change together, then submits after hooks",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				const result = yield* run();
				expect(result).toMatchObject({ count: 1, warnings: [], failure: null });
				expect(yield* h.calls).toEqual([
					"begin",
					"plan:request",
					"commit",
					"begin",
					"write",
					"plan:change",
					"commit",
					"after",
					"begin",
					"plan:change",
					"commit",
					"after",
				]);
				const triggers = yield* h.triggers;
				expect(triggers[1]?.causation.parentTriggerId).toBe(triggers[0]?.id);
				expect(triggers[1]?.payload).toMatchObject({
					after: {
						entityId,
						createdAt: now,
						updatedAt: now,
						eventSchemaSlug,
						occurredAt: now,
						entitySchemaSlug,
						sessionEntityId: null,
						properties: { rating: 1 },
					},
				});
			}),
	);
});

layer(harnessLayer({ replayWriteAfterSchemaDisable: true }))((test) => {
	test.effect("replays a committed write activity after the event schema is disabled", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect(yield* run()).toMatchObject({ count: 1, warnings: [], failure: null });
			expect(yield* h.created).toHaveLength(1);
			expect(yield* h.triggers).toHaveLength(3);
			expect((yield* h.calls).filter((call) => call === "write")).toHaveLength(1);
		}),
	);
});

layer(
	harnessLayer({
		policies: [
			{ slug: "z", plugin: "b", position: 2 },
			{ slug: "z", plugin: "a", position: 2 },
			{ slug: "a", plugin: "a", position: 2 },
			{ slug: "last", position: 10 },
		],
		execute: ({ index, payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			expect(request.draft.properties["rating"]).toBe(index + 1);
			return Effect.succeed({
				action: "transform",
				patch: {
					resource: "event",
					draft: {
						sessionEntityId: EntityId.make("session"),
						properties: { remove: [], set: { rating: index + 2 } },
					},
				},
			});
		},
	}),
)((test) => {
	test.effect(
		"chains transforms in position/plugin/hook order and preserves trusted draft fields",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				yield* run();
				expect(yield* h.executed).toEqual(["a/a", "a/z", "b/z", "plugin/last"]);
				const created = yield* h.created;
				expect(created[0]).toMatchObject({
					entityId,
					eventSchemaSlug,
					properties: { rating: 5 },
					sessionEntityId: "session",
				});
				expect(created[0]?.occurredAt.toISOString()).toBe(now);
				expect(
					(yield* h.inputs).every(
						(input) =>
							input.resource === "event" &&
							input.draft.entityId === entityId &&
							input.draft.entitySchemaSlug === entitySchemaSlug,
					),
				).toBe(true);
			}),
	);
});

layer(
	harnessLayer({
		execute: () => Effect.succeed({ action: "reject", reason: "Declined" }),
		policies: [
			{ position: 1, slug: "first" },
			{ position: 2, slug: "second" },
		],
	}),
)((test) => {
	test.effect(
		"rejection closes remaining policies and creates no domain row or change trigger",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				expect(yield* run()).toEqual({
					count: 0,
					warnings: [],
					failure: null,
					outcomes: [{ index: 0, reason: "Declined", status: "skipped_by_policy" }],
				});
				expect(yield* h.inputs).toHaveLength(1);
				expect(yield* h.created).toEqual([]);
				expect(yield* h.triggers).toHaveLength(1);
				expect((yield* h.queued).size).toBe(0);
			}),
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "fail" },
			{ position: 2, slug: "later" },
		],
		execute: ({ runId }) =>
			new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
	}),
)((test) => {
	test.effect("returns stable failed run identity and closes unstarted policies", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			const result = yield* run();
			expect(result.failure).toMatchObject({
				index: 0,
				reason: { runId: expect.any(String), code: "policy-execution-failed" },
			});
			expect(yield* h.created).toEqual([]);
			expect((yield* h.queued).size).toBe(0);
		}),
	);
});

layer(
	harnessLayer({
		policies: [{ position: 1, slug: "invalid" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				patch: {
					resource: "event",
					draft: { properties: { remove: [], set: { rating: "invalid" } } },
				},
			});
		},
	}),
)((test) => {
	test.effect("revalidates final transformed properties before writing", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect((yield* run()).failure).toEqual({ index: 0, reason: { code: "invalid-properties" } });
			expect(yield* h.created).toEqual([]);
			expect(yield* h.triggers).toHaveLength(1);
		}),
	);
});

const hiddenSession = EntityId.make("hidden-session");

layer(
	harnessLayer({
		unreadableEntity: hiddenSession,
		policies: [{ position: 1, slug: "session" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				patch: { resource: "event", draft: { sessionEntityId: hiddenSession } },
			});
		},
	}),
)((test) => {
	test.effect("revalidates a transformed session reference before writing", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect((yield* run()).failure).toEqual({
				index: 0,
				reason: { entityId: hiddenSession, code: "session-entity-not-found" },
			});
			expect(yield* h.created).toEqual([]);
			expect(yield* h.triggers).toHaveLength(1);
		}),
	);
});

layer(
	harnessLayer({
		policies: [{ position: 1, slug: "session" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				patch: { resource: "event", draft: { sessionEntityId: EntityId.make("   ") } },
			});
		},
	}),
)((test) => {
	test.effect("normalizes an empty transformed session reference before writing", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect(yield* run()).toMatchObject({ count: 1, failure: null });
			expect((yield* h.created)[0]?.sessionEntityId).toBeUndefined();
			expect(yield* h.lockedEntityIds).toEqual([[entityId]]);
		}),
	);
});

const racingSession = EntityId.make("racing-session");

layer(
	harnessLayer({
		revokeEntityBeforeWrite: racingSession,
		policies: [{ position: 1, slug: "session" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				patch: { resource: "event", draft: { sessionEntityId: racingSession } },
			});
		},
	}),
)((test) => {
	test.effect(
		"locks and revalidates the transformed session reference in the write transaction",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				expect((yield* run()).failure).toEqual({
					index: 0,
					reason: { entityId: racingSession, code: "session-entity-not-found" },
				});
				expect(yield* h.lockedEntityIds).toEqual([[entityId, racingSession]]);
				expect(yield* h.created).toEqual([]);
			}),
	);
});

layer(
	harnessLayer({
		policies: [{ position: 1, slug: "policy" }],
		execute: ({ runId, payload: request }) =>
			request.draft.properties["rating"] === 2
				? new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" })
				: Effect.succeed({ action: "allow" as const }),
	}),
)((test) => {
	test.effect(
		"a later item failure keeps earlier committed events and stops the remaining batch",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				const result = yield* run({
					...payload,
					payload: [1, 2, 3].map((rating) => ({
						entityId,
						eventSchemaSlug,
						properties: { rating },
					})),
				});
				expect(result).toMatchObject({
					count: 1,
					failure: { index: 1, reason: { code: "policy-execution-failed" } },
				});
				expect(result.outcomes).toHaveLength(1);
				expect(yield* h.created).toHaveLength(1);
				expect(yield* h.inputs).toHaveLength(2);
				expect((yield* h.queued).size).toBe(0);
			}),
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "first" },
			{ position: 2, slug: "repair" },
		],
		execute: ({ index, payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				patch: {
					resource: "event",
					draft: {
						properties: { remove: [], set: { rating: index === 0 ? "intermediate" : 1.2345 } },
					},
				},
			});
		},
	}),
)((test) => {
	test.effect("rejects an invalid intermediate patch before running the next policy", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			expect((yield* run()).failure).toEqual({ index: 0, reason: { code: "invalid-properties" } });
			expect(yield* h.executed).toHaveLength(1);
			expect(yield* h.created).toEqual([]);
		}),
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "reject-once", frequency: "once-per-subject" },
			{ position: 2, slug: "later", frequency: "once-per-subject" },
		],
		execute: ({ index }) =>
			Effect.succeed(
				index === 0
					? { reason: "First only", action: "reject" as const }
					: { action: "allow" as const },
			),
	}),
)((test) => {
	test.effect(
		"consumes a rejecting subject policy on the first eligible item, but keeps later unstarted policies eligible",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				const result = yield* run({
					...payload,
					payload: [...payload.payload, ...payload.payload, ...payload.payload],
				});
				expect(result.count).toBe(2);
				expect(yield* h.executed).toEqual(["plugin/reject-once", "plugin/later"]);
				expect(yield* h.exclusions).toEqual([
					[],
					[{ pluginId: "plugin", hookSlug: "reject-once" }],
					[
						{ pluginId: "plugin", hookSlug: "reject-once" },
						{ hookSlug: "later", pluginId: "plugin" },
					],
				]);
				expect((yield* h.queued).size).toBe(0);
			}),
	);
});

layer(
	harnessLayer({
		policies: [
			{ position: 1, slug: "subject", frequency: "once-per-subject" },
			{ position: 2, slug: "item" },
		],
	}),
)((test) => {
	test.effect(
		"excludes only processed once-per-subject identities before planning each later item",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				const [item] = payload.payload;
				assert(item);
				const result = yield* run({
					...payload,
					payload: [item, item, { ...item, entityId: EntityId.make("other") }],
				});
				expect(result.count).toBe(3);
				expect(yield* h.exclusions).toEqual([
					[],
					[{ pluginId: "plugin", hookSlug: "subject" }],
					[],
				]);
				expect(yield* h.inputs).toHaveLength(5);
				expect((yield* h.queued).size).toBe(0);
			}),
	);
});

layer(harnessLayer({ failChange: true }))((test) => {
	test.effect("retains request history and rolls back an event when change planning fails", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			assertExitFails(yield* Effect.exit(run()), new DbError({ message: "planning failed" }));
			expect(yield* h.created).toEqual([]);
			expect((yield* h.triggers).map((trigger) => trigger.kind.category)).toEqual(["request"]);
			expect(yield* h.calls).toContain("rollback");
			expect(yield* h.calls).not.toContain("after");
		}),
	);
});

layer(harnessLayer({ activateSchemaBeforeWrite: true }))((test) => {
	test.effect("rejects a schema activation that occurs between planning and the source write", () =>
		Effect.gen(function* () {
			const h = yield* EventCreateHarness;
			const result = yield* run();
			expect(result.failure).toEqual({
				index: 0,
				reason: { eventSchemaSlug, code: "event-schema-not-found" },
			});
			expect(yield* h.created).toEqual([]);
			expect(yield* h.calls).toContain("rollback");
		}),
	);
});

layer(harnessLayer({ blocked: "request" }))((test) => {
	test.effect(
		"a blocked request fails closed while required failures remain successful warnings",
		() =>
			Effect.gen(function* () {
				const h = yield* EventCreateHarness;
				expect((yield* run()).failure).toMatchObject({
					reason: { triggerId: expect.any(String), code: "automation-limit-reached" },
				});
				expect(yield* h.created).toEqual([]);
				const warning = {
					code: "required-hook-failed" as const,
					runId: AutomationRunId.make("required-run"),
					hookSlug: AutomationHookSlug.make("required"),
				};
				yield* h.reset({ warnings: [warning] });
				expect(
					yield* run({
						...payload,
						command: {
							...command,
							causation: {
								...command.causation,
								executionId: AutomationExecutionId.make("required-warning"),
							},
						},
					}),
				).toMatchObject({ count: 1, failure: null, warnings: [warning, warning] });
				expect(yield* h.created).toHaveLength(1);
				yield* h.reset({ blocked: "change" });
				expect(
					yield* run({
						...payload,
						command: {
							...command,
							causation: {
								...command.causation,
								executionId: AutomationExecutionId.make("blocked-change"),
							},
						},
					}),
				).toMatchObject({
					count: 1,
					failure: null,
					warnings: [{ code: "automation-limit-reached" }, { code: "automation-limit-reached" }],
				});
			}),
	);
});
