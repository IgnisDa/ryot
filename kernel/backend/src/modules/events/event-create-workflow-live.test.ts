import { assert, expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEventSnapshot,
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
import { Effect, Exit, Layer, Schema } from "effect";
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
import { Database } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeWorkflowEngine } from "#lib/test-utils/effect";
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

const harness = (
	options: {
		unreadableEntity?: EntityId;
		revokeEntityBeforeWrite?: EntityId;
		policies?: Policy[];
		execute?: LifecycleExecution["Service"]["executePolicy"];
		blocked?: "request" | "change";
		warnings?: AutomationWarning[];
		failChange?: boolean;
		activateSchemaBeforeWrite?: boolean;
		replayWriteAfterSchemaDisable?: boolean;
	} = {},
) => {
	const calls: string[] = [];
	const triggers: AutomationTrigger[] = [];
	const created: Array<Parameters<EventsRepository["Service"]["createEvent"]>[0]> = [];
	const inputs: AutomationRequestPayload[] = [];
	const exclusions: unknown[] = [];
	const queued = new Set<string>();
	const identities = new Map<string, string>();
	const executed: string[] = [];
	const lockedEntityIds: EntityId[][] = [];
	let activeTransaction = false;
	let activeActivity = false;
	let schemaActivated = false;
	let schemaDisabled = false;
	const tx: Parameters<Parameters<Database["Service"]["transaction"]>[0]>[0] = Object.assign(
		Object.create(null),
		{},
	);
	const database = Database.of(
		Object.assign(Object.create(null), {
			transaction: ((callback) =>
				Effect.gen(function* () {
					expect(activeActivity).toBe(true);
					expect(activeTransaction).toBe(false);
					const saved = { created: created.length, triggers: triggers.length };
					activeTransaction = true;
					calls.push("begin");
					return yield* callback(tx).pipe(
						Effect.tapError(() =>
							Effect.sync(() => {
								triggers.length = saved.triggers;
								created.length = saved.created;
								calls.push("rollback");
							}),
						),
						Effect.tap(() =>
							Effect.sync(() => {
								calls.push("commit");
							}),
						),
						Effect.ensuring(
							Effect.sync(() => {
								activeTransaction = false;
							}),
						),
					);
				})) satisfies Database["Service"]["transaction"],
		}),
	);
	const planner = LifecyclePlanner.of({
		plan: (input) =>
			Effect.gen(function* () {
				expect(activeTransaction).toBe(true);
				expect(yield* Database).toBe(tx);
				const trigger = input.trigger;
				const existing = triggers.find(({ id }) => id === trigger.id);
				if (existing) {
					if (!Bun.deepEquals(existing, trigger)) {
						return yield* new DbError({ message: "Automation trigger identity conflict" });
					}
					calls.push(`plan:${trigger.kind.category}`);
					return { runs: [], policies: [], trigger: existing, wasCreated: false };
				}
				if (trigger.kind.category === "change" && options.failChange) {
					return yield* new DbError({ message: "planning failed" });
				}
				calls.push(`plan:${trigger.kind.category}`);
				triggers.push(trigger);
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
									{ pluginId: PluginId.make("plugin"), hookSlug: AutomationHookSlug.make("hook") },
								],
							},
						},
					};
				}
				if (trigger.kind.category !== "request") {
					return { trigger, runs: [], policies: [], wasCreated: true };
				}
				exclusions.push(input.excludedOncePerSubjectPolicies);
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
				for (const run of runs) {
					queued.add(run.id);
					identities.set(run.id, `${run.pluginId}/${run.hookSlug}`);
				}
				assert(trigger.payload?.category === "request" && trigger.payload.resource === "event");
				return {
					runs,
					wasCreated: true,
					trigger: {
						...trigger,
						payload: {
							...trigger.payload,
							excludedOncePerSubjectPolicies: input.excludedOncePerSubjectPolicies ?? [],
						},
					},
					policies: runs.map((run, index) => ({
						runId: run.id,
						batchFrequency: declarations[index]?.frequency,
						position: declarations[index]?.position ?? 1000,
					})),
				};
			}),
	});
	const execution = LifecycleExecution.of({
		skipQueuedPolicies: () =>
			Effect.sync(() => {
				expect(activeTransaction).toBe(false);
				calls.push("skip");
				queued.clear();
			}),
		after: () =>
			Effect.sync(() => {
				expect(activeTransaction).toBe(false);
				expect(activeActivity).toBe(false);
				calls.push("after");
				return options.warnings ?? [];
			}),
		executePolicy: (input) =>
			Effect.gen(function* () {
				expect(activeTransaction).toBe(false);
				expect(activeActivity).toBe(false);
				inputs.push(input.payload);
				executed.push(identities.get(input.runId) ?? "missing");
				calls.push("policy");
				queued.delete(input.runId);
				return yield* options.execute?.(input) ?? Effect.succeed({ action: "allow" as const });
			}),
	});
	const dependencies = Layer.mergeAll(
		Layer.succeed(Database, database),
		Layer.succeed(LifecyclePlanner, planner),
		Layer.succeed(LifecycleExecution, execution),
		Layer.mock(EntitiesRepository)({
			lockEntityReferencesByIds: (entityIds) =>
				Effect.sync(() => {
					expect(activeTransaction).toBe(true);
					lockedEntityIds.push([...entityIds]);
				}),
			getEntityScopeForUser: ({ entityId: requestedId }) =>
				Effect.succeed(
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
				Effect.sync(() => {
					schemaActivated = options.activateSchemaBeforeWrite ?? false;
				}),
			getScopeForUser: () =>
				Effect.succeed(
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
					expect(activeTransaction).toBe(true);
					expect(activeActivity).toBe(true);
					expect(yield* Database).toBe(tx);
					created.push(input);
					calls.push("write");
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
			getEventCreateReplay: ({ eventId }) => {
				const event = created.find(({ id }) => id === eventId);
				return event
					? Effect.succeed({
							eventSchemaPluginId: event.eventSchemaPluginId,
							event: Schema.decodeUnknownSync(AutomationEventSnapshot)({
								id: event.id,
								createdAt: now,
								updatedAt: now,
								entitySchemaSlug,
								entityId: event.entityId,
								properties: event.properties,
								eventSchemaSlug: event.eventSchemaSlug,
								occurredAt: event.occurredAt.toISOString(),
								sessionEntityId: event.sessionEntityId ?? null,
							}),
						})
					: Effect.succeed(null);
			},
		}),
	);
	const run = (input = payload) => {
		const instance = WorkflowInstance.initial(EventCreateWorkflow, "workflow");
		const engine = makeWorkflowEngine({
			activityExecute: (activity) =>
				Effect.gen(function* () {
					activeActivity = true;
					let exit = yield* Effect.exit(activity.execute);
					if (
						options.replayWriteAfterSchemaDisable &&
						activity.name === "write-event-0" &&
						Exit.isSuccess(exit)
					) {
						schemaDisabled = true;
						exit = yield* Effect.exit(activity.execute);
					}
					return new Workflow.Complete({ exit });
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							activeActivity = false;
						}),
					),
				),
		});
		return runEventCreateWorkflow(input, "workflow").pipe(
			Effect.provide(dependencies),
			Effect.provideService(WorkflowEngine, engine),
			Effect.provideService(WorkflowInstance, instance),
		);
	};
	return { run, calls, inputs, queued, created, triggers, executed, exclusions, lockedEntityIds };
};

it.effect(
	"plans before sandboxes, commits the exact event and change together, then submits after hooks",
	() => {
		const h = harness();
		return Effect.gen(function* () {
			const result = yield* h.run();
			expect(result).toMatchObject({ count: 1, warnings: [], failure: null });
			expect(h.calls).toEqual([
				"begin",
				"plan:request",
				"commit",
				"begin",
				"write",
				"plan:change",
				"commit",
				"after",
			]);
			expect(h.triggers[1]?.causation.parentTriggerId).toBe(h.triggers[0]?.id);
			expect(h.triggers[1]?.payload).toMatchObject({
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
		});
	},
);

it.effect("replays a committed write activity after the event schema is disabled", () => {
	const h = harness({ replayWriteAfterSchemaDisable: true });
	return Effect.gen(function* () {
		expect(yield* h.run()).toMatchObject({ count: 1, warnings: [], failure: null });
		expect(h.created).toHaveLength(1);
		expect(h.triggers).toHaveLength(2);
		expect(h.calls.filter((call) => call === "write")).toHaveLength(1);
	});
});

it.effect(
	"chains transforms in position/plugin/hook order and preserves trusted draft fields",
	() => {
		let step = 0;
		const h = harness({
			policies: [
				{ slug: "z", plugin: "b", position: 2 },
				{ slug: "z", plugin: "a", position: 2 },
				{ slug: "a", plugin: "a", position: 2 },
				{ slug: "last", position: 10 },
			],
			execute: ({ payload: request }) => {
				assert(request.resource === "event" && request.operation === "create");
				expect(request.draft.properties["rating"]).toBe(step + 1);
				step += 1;
				return Effect.succeed({
					action: "transform",
					payload: {
						...request,
						draft: {
							...request.draft,
							properties: { rating: step + 1 },
							entityId: EntityId.make("untrusted"),
							occurredAt: "1999-01-01T00:00:00.000Z",
							sessionEntityId: EntityId.make("session"),
							eventSchemaSlug: EventSchemaSlug.make("untrusted"),
						},
					},
				});
			},
		});
		return Effect.gen(function* () {
			yield* h.run();
			expect(h.executed).toEqual(["a/a", "a/z", "b/z", "plugin/last"]);
			expect(h.created[0]).toMatchObject({
				entityId,
				eventSchemaSlug,
				properties: { rating: 5 },
				sessionEntityId: "session",
			});
			expect(h.created[0]?.occurredAt.toISOString()).toBe(now);
			expect(
				h.inputs.every(
					(input) =>
						input.resource === "event" &&
						input.draft.entityId === entityId &&
						input.draft.entitySchemaSlug === entitySchemaSlug,
				),
			).toBe(true);
		});
	},
);

it.effect("rejection closes remaining policies and creates no domain row or change trigger", () => {
	const h = harness({
		execute: () => Effect.succeed({ action: "reject", reason: "Declined" }),
		policies: [
			{ position: 1, slug: "first" },
			{ position: 2, slug: "second" },
		],
	});
	return Effect.gen(function* () {
		expect(yield* h.run()).toEqual({
			count: 0,
			warnings: [],
			failure: null,
			outcomes: [{ index: 0, reason: "Declined", status: "skipped_by_policy" }],
		});
		expect(h.inputs).toHaveLength(1);
		expect(h.created).toEqual([]);
		expect(h.triggers).toHaveLength(1);
		expect(h.queued.size).toBe(0);
	});
});

it.effect("returns stable failed run identity and closes unstarted policies", () => {
	const h = harness({
		policies: [
			{ position: 1, slug: "fail" },
			{ position: 2, slug: "later" },
		],
		execute: ({ runId }) =>
			new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" }),
	});
	return Effect.gen(function* () {
		const result = yield* h.run();
		expect(result.failure).toMatchObject({
			index: 0,
			reason: { runId: expect.any(String), code: "policy-execution-failed" },
		});
		expect(h.created).toEqual([]);
		expect(h.queued.size).toBe(0);
	});
});

it.effect("revalidates final transformed properties before writing", () => {
	const h = harness({
		policies: [{ position: 1, slug: "invalid" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				payload: { ...request, draft: { ...request.draft, properties: { rating: "invalid" } } },
			});
		},
	});
	return Effect.gen(function* () {
		expect((yield* h.run()).failure).toEqual({ index: 0, reason: { code: "invalid-properties" } });
		expect(h.created).toEqual([]);
		expect(h.triggers).toHaveLength(1);
	});
});

it.effect("revalidates a transformed session reference before writing", () => {
	const session = EntityId.make("hidden-session");
	const h = harness({
		unreadableEntity: session,
		policies: [{ position: 1, slug: "session" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				payload: { ...request, draft: { ...request.draft, sessionEntityId: session } },
			});
		},
	});
	return Effect.gen(function* () {
		expect((yield* h.run()).failure).toEqual({
			index: 0,
			reason: { entityId: session, code: "session-entity-not-found" },
		});
		expect(h.created).toEqual([]);
		expect(h.triggers).toHaveLength(1);
	});
});

it.effect("normalizes an empty transformed session reference before writing", () => {
	const h = harness({
		policies: [{ position: 1, slug: "session" }],
		execute: ({ payload: request }) => {
			assert(request.resource === "event" && request.operation === "create");
			return Effect.succeed({
				action: "transform",
				payload: { ...request, draft: { ...request.draft, sessionEntityId: EntityId.make("   ") } },
			});
		},
	});
	return Effect.gen(function* () {
		expect(yield* h.run()).toMatchObject({ count: 1, failure: null });
		expect(h.created[0]?.sessionEntityId).toBeUndefined();
		expect(h.lockedEntityIds).toEqual([[entityId]]);
	});
});

it.effect(
	"locks and revalidates the transformed session reference in the write transaction",
	() => {
		const session = EntityId.make("racing-session");
		const h = harness({
			revokeEntityBeforeWrite: session,
			policies: [{ position: 1, slug: "session" }],
			execute: ({ payload: request }) => {
				assert(request.resource === "event" && request.operation === "create");
				return Effect.succeed({
					action: "transform",
					payload: { ...request, draft: { ...request.draft, sessionEntityId: session } },
				});
			},
		});
		return Effect.gen(function* () {
			expect((yield* h.run()).failure).toEqual({
				index: 0,
				reason: { entityId: session, code: "session-entity-not-found" },
			});
			expect(h.lockedEntityIds).toEqual([[entityId, session]]);
			expect(h.created).toEqual([]);
		});
	},
);

it.effect(
	"a later item failure keeps earlier committed events and stops the remaining batch",
	() => {
		const h = harness({
			policies: [{ position: 1, slug: "policy" }],
			execute: ({ runId, payload: request }) =>
				request.draft.properties["rating"] === 2
					? new AutomationPolicyExecutionError({ runId, code: "policy-execution-failed" })
					: Effect.succeed({ action: "allow" as const }),
		});
		return Effect.gen(function* () {
			const result = yield* h.run({
				...payload,
				payload: [1, 2, 3].map((rating) => ({ entityId, eventSchemaSlug, properties: { rating } })),
			});
			expect(result).toMatchObject({
				count: 1,
				failure: { index: 1, reason: { code: "policy-execution-failed" } },
			});
			expect(result.outcomes).toHaveLength(1);
			expect(h.created).toHaveLength(1);
			expect(h.inputs).toHaveLength(2);
			expect(h.queued.size).toBe(0);
		});
	},
);

it.effect(
	"allows a later policy to repair intermediate properties and normalizes the final value",
	() => {
		let step = 0;
		const h = harness({
			policies: [
				{ position: 1, slug: "first" },
				{ position: 2, slug: "repair" },
			],
			execute: ({ payload: request }) => {
				assert(request.resource === "event" && request.operation === "create");
				step += 1;
				if (step === 2) {
					expect(request.draft.properties).toEqual({ rating: "intermediate" });
				}
				return Effect.succeed({
					action: "transform",
					payload: {
						...request,
						draft: {
							...request.draft,
							properties: { rating: step === 1 ? "intermediate" : 1.2345 },
						},
					},
				});
			},
		});
		return Effect.gen(function* () {
			expect((yield* h.run()).count).toBe(1);
			expect(h.created[0]?.properties).toEqual({ rating: 1.23 });
		});
	},
);

it.effect(
	"consumes a rejecting subject policy on the first eligible item, but keeps later unstarted policies eligible",
	() => {
		let first = true;
		const h = harness({
			policies: [
				{ position: 1, slug: "reject-once", frequency: "once-per-subject" },
				{ position: 2, slug: "later", frequency: "once-per-subject" },
			],
			execute: () => {
				if (first) {
					first = false;
					return Effect.succeed({ reason: "First only", action: "reject" as const });
				}
				return Effect.succeed({ action: "allow" as const });
			},
		});
		return Effect.gen(function* () {
			const result = yield* h.run({
				...payload,
				payload: [...payload.payload, ...payload.payload, ...payload.payload],
			});
			expect(result.count).toBe(2);
			expect(h.executed).toEqual(["plugin/reject-once", "plugin/later"]);
			expect(h.exclusions).toEqual([
				[],
				[{ pluginId: "plugin", hookSlug: "reject-once" }],
				[
					{ pluginId: "plugin", hookSlug: "reject-once" },
					{ hookSlug: "later", pluginId: "plugin" },
				],
			]);
			expect(h.queued.size).toBe(0);
		});
	},
);

it.effect(
	"excludes only processed once-per-subject identities before planning each later item",
	() => {
		const h = harness({
			policies: [
				{ position: 1, slug: "subject", frequency: "once-per-subject" },
				{ position: 2, slug: "item" },
			],
		});
		return Effect.gen(function* () {
			const [item] = payload.payload;
			assert(item);
			const result = yield* h.run({
				...payload,
				payload: [item, item, { ...item, entityId: EntityId.make("other") }],
			});
			expect(result.count).toBe(3);
			expect(h.exclusions).toEqual([[], [{ pluginId: "plugin", hookSlug: "subject" }], []]);
			expect(h.inputs).toHaveLength(5);
			expect(h.queued.size).toBe(0);
		});
	},
);

it.effect("retains request history and rolls back an event when change planning fails", () => {
	const h = harness({ failChange: true });
	return Effect.gen(function* () {
		assertExitFails(yield* Effect.exit(h.run()), new DbError({ message: "planning failed" }));
		expect(h.created).toEqual([]);
		expect(h.triggers.map((trigger) => trigger.kind.category)).toEqual(["request"]);
		expect(h.calls).toContain("rollback");
		expect(h.calls).not.toContain("after");
	});
});

it.effect("rejects a schema activation that occurs between planning and the source write", () => {
	const h = harness({ activateSchemaBeforeWrite: true });
	return Effect.gen(function* () {
		const result = yield* h.run();
		expect(result.failure).toEqual({
			index: 0,
			reason: { eventSchemaSlug, code: "event-schema-not-found" },
		});
		expect(h.created).toEqual([]);
		expect(h.calls).toContain("rollback");
	});
});

it.effect("a blocked request fails closed while required failures remain successful warnings", () =>
	Effect.gen(function* () {
		const blocked = harness({ blocked: "request" });
		expect((yield* blocked.run()).failure).toMatchObject({
			reason: { triggerId: expect.any(String), code: "automation-limit-reached" },
		});
		expect(blocked.created).toEqual([]);
		const warning = {
			code: "required-hook-failed" as const,
			runId: AutomationRunId.make("required-run"),
			hookSlug: AutomationHookSlug.make("required"),
		};
		const accepted = harness({ warnings: [warning] });
		expect(yield* accepted.run()).toMatchObject({ count: 1, failure: null, warnings: [warning] });
		expect(accepted.created).toHaveLength(1);
		const limited = harness({ blocked: "change" });
		expect(yield* limited.run()).toMatchObject({
			count: 1,
			failure: null,
			warnings: [{ code: "automation-limit-reached" }],
		});
	}),
);
