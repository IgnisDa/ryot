import { expect, layer } from "@effect/vitest";
import {
	AutomationEntityChangePayload,
	AutomationTrigger,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationHookSlug,
	AutomationTriggerId,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { assert, describe } from "vitest";

import { LifecyclePlanner, lifecycleRunId } from "#lib/domain/lifecycle";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { seedKernelDefinitions } from "#modules/definition-registry/test-support";
import { mutationReceiptIdentity, MutationReceipts } from "#modules/mutations/receipts";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/revision.test-support";

import { LifecyclePlannerServiceLive } from "./layer";
import { triggerFixture } from "./lifecycle.test-support";
import { LifecyclePlannerLive } from "./planner";
import { AutomationPlannerResolver } from "./planner-resolver";
import { AutomationRunRepository } from "./run-repository";
import { AutomationTriggerRepository } from "./trigger-repository";

const nested = <A, E, R>(body: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		return yield* (yield* DatabaseSession).transaction(body);
	});
const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const plannerLayer = (maxRuns = 100, batchMaxItems = 200) =>
	LifecyclePlannerServiceLive.pipe(
		Layer.provide(
			makeAppConfigLayer({
				automations: { maxRuns, maxDepth: 2, batchMaxItems, retryWindowDays: 7 },
			}),
		),
	);
class LargerBudgetPlanner extends Context.Service<
	LargerBudgetPlanner,
	LifecyclePlanner["Service"]
>()("test/LargerBudgetPlanner") {}

const largerBudgetPlannerLayer = Layer.effect(
	LargerBudgetPlanner,
	Effect.service(LifecyclePlanner),
).pipe(Layer.provide(plannerLayer(10000)));
const asDescendant = <T extends ReturnType<typeof entityTrigger>>(trigger: T) => ({
	...trigger,
	causation: { ...trigger.causation, depth: 1 },
});
const entityTrigger = (
	id = "entity",
	category: "request" | "change" = "change",
	operation: "create" | "update" | "delete" = "create",
) => {
	const snapshot = {
		id: "entity",
		name: "Entity",
		properties: {},
		externalId: null,
		providerId: null,
		populatedAt: null,
		entitySchemaSlug: "fixture-entity",
		createdAt: "2026-09-15T00:00:00.000Z",
		updatedAt: "2026-09-15T00:00:00.000Z",
	};
	const { id: _id, createdAt: _created, updatedAt: _updated, ...draft } = snapshot;
	const change =
		operation === "delete"
			? { before: snapshot }
			: { after: snapshot, ...(operation === "update" ? { before: snapshot } : {}) };
	return Schema.decodeUnknownSync(AutomationTrigger)({
		...triggerFixture(id),
		scopeUserId: owner,
		kind: { category, operation, resource: "entity" },
		payload: {
			category,
			operation,
			resource: "entity",
			...(category === "request"
				? {
						draft: operation === "delete" ? snapshot : draft,
						...(operation === "update" ? { before: snapshot } : {}),
					}
				: change),
		},
	});
};

const entityChange = (id: string, entitySchemaSlug = "fixture-entity") => ({
	category: "change" as const,
	resource: "entity" as const,
	operation: "create" as const,
	after: {
		id,
		name: "Entity",
		properties: {},
		entitySchemaSlug,
		externalId: null,
		providerId: null,
		populatedAt: null,
		createdAt: "2026-09-15T00:00:00.000Z",
		updatedAt: "2026-09-15T00:00:00.000Z",
	},
});
const entityBatchTrigger = (id: string, items: ReadonlyArray<ReturnType<typeof entityChange>>) =>
	Schema.decodeSync(AutomationTrigger)({
		...triggerFixture(id),
		scopeUserId: owner,
		kind: { category: "change", operation: "batch", resource: "entity" },
		payload: { items, category: "change", operation: "batch", resource: "entity" },
	});

type HookDeclaration = PluginManifest["hooks"][number];

const asAsyncDelivery = (entry: HookDeclaration): HookDeclaration =>
	entry.stage === "after" ? { ...entry, delivery: "async" } : entry;

const hookPackage = (version = "v1") => {
	const value = revisionPackage("fixture", version);
	const script = value.manifest.scripts[0];
	assert(script?.kind === "automation");
	const compiledScript = value.scripts[0];
	assert(compiledScript);
	const policyScript = {
		...script,
		capabilities: [],
		slug: "fixture.policy",
		automationType: "policy" as const,
		inputProjection: {
			event: { properties: [] },
			entity: { properties: [] },
			relationship: { properties: [] },
		},
	};
	const targets = (["create", "update", "delete"] as const).map((operation) => ({
		operation,
		resource: "entity" as const,
		entitySchemaSlug: "fixture-entity",
	}));
	return {
		...value,
		scripts: [
			...value.scripts,
			{
				...compiledScript,
				slug: "fixture.policy",
				metadata: policyScript,
				contentHash: `policy-${version}`,
			},
		],
		manifest: {
			...value.manifest,
			scripts: [...value.manifest.scripts, policyScript],
			hooks: [
				...value.manifest.hooks,
				{
					targets,
					position: -1,
					name: "First policy",
					slug: "fixture.z-first",
					stage: "before" as const,
					scriptSlug: "fixture.policy",
				},
				{
					targets,
					name: "Second policy",
					slug: "fixture.a-second",
					stage: "before" as const,
					scriptSlug: "fixture.policy",
				},
				{
					targets,
					name: "Changed",
					slug: "fixture.changed",
					stage: "after" as const,
					delivery: "required" as const,
					scriptSlug: "fixture.automation",
					causationSources: ["api" as const],
				},
			],
		},
	};
};

const afterHookPackage = (
	version: string,
	addition: { frequency?: "item" | "batch"; executionScope?: "user" | "global" },
) => {
	const value = hookPackage(version);
	return {
		...value,
		manifest: {
			...value.manifest,
			hooks: value.manifest.hooks.map((hook) =>
				hook.slug === "fixture.changed" ? Object.assign(hook, addition) : hook,
			),
		},
	};
};

const eventPolicyPackage = (
	version: string,
	position: number,
	batchFrequency: "once-per-subject" | "item",
) => {
	const value = hookPackage(version);
	return {
		...value,
		manifest: {
			...value.manifest,
			hooks: value.manifest.hooks.map((hook) =>
				hook.stage === "before"
					? Object.assign(hook, {
							position,
							batchFrequency,
							targets: [
								{
									resource: "event" as const,
									eventSchemaSlug: "changed",
									operation: "create" as const,
									entitySchemaSlug: "fixture-entity",
								},
							],
						})
					: hook,
			),
		},
	};
};
const eventPolicyTrigger = (id = "event-policy") =>
	Schema.decodeEffect(AutomationTrigger)({
		...triggerFixture(id),
		scopeUserId: owner,
		kind: { resource: "event", category: "request", operation: "create" },
		payload: {
			resource: "event",
			category: "request",
			operation: "create",
			draft: {
				properties: {},
				entityId: "subject",
				sessionEntityId: null,
				eventSchemaSlug: "changed",
				entitySchemaSlug: "fixture-entity",
				occurredAt: "2026-09-15T00:00:00.000Z",
			},
		},
	});

describe("LifecyclePlanner PostgreSQL", () => {
	layer(
		LifecyclePlannerLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(AutomationPlannerResolver, {
						lockCatalog: () => Effect.void,
						resolve: () => Effect.succeed([]),
						resolveBatchCandidates: () => Effect.succeed([]),
					}),
					AutomationRunRepository.layer,
					AutomationTriggerRepository.layer,
				),
			),
			Layer.provide(makeAppConfigLayer()),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect("uses the resolver supplied at planner construction", () =>
			Effect.gen(function* () {
				yield* installRevisionPackage(hookPackage());
				const planned = yield* (yield* LifecyclePlanner).plan({
					trigger: entityTrigger("injected-resolver"),
				});
				expect(planned.runs).toEqual([]);
				expect(planned).toEqual({
					runs: [],
					policies: [],
					trigger: null,
					_tag: "NoHooks",
					wasCreated: false,
				});
				const session = yield* DatabaseSession;
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
				expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual([]);
			}),
		);
	});

	layer(plannerLayer(1).pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect("omits all-excluded requests without spending automation budget", () =>
			Effect.gen(function* () {
				const planner = yield* LifecyclePlanner;
				const session = yield* DatabaseSession;
				const installed = yield* installRevisionPackage(
					eventPolicyPackage("v1", 7, "once-per-subject"),
				);
				const exclusions = ["fixture.a-second", "fixture.z-first"].map((hookSlug) => ({
					pluginId: PluginId.make(installed.pluginId),
					hookSlug: AutomationHookSlug.make(hookSlug),
				}));
				const [a, z] = exclusions;
				assert(a && z);
				const trigger = yield* eventPolicyTrigger("all-excluded");
				const result = yield* planner.plan({ trigger, excludedOncePerSubjectPolicies: [z, a, z] });
				expect(result).toEqual({
					runs: [],
					policies: [],
					trigger: null,
					_tag: "NoHooks",
					wasCreated: false,
				});
				const [stored] = yield* session.run((db) =>
					db
						.select()
						.from(tables.automationTrigger)
						.where(eq(tables.automationTrigger.id, trigger.id)),
				);
				expect(stored).toBeUndefined();
				expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual([]);
				expect(yield* planner.plan({ trigger, excludedOncePerSubjectPolicies: [a, z, a] })).toEqual(
					result,
				);
				yield* installRevisionPackage(eventPolicyPackage("v2", 99, "item"));
				expect(
					(yield* nested(planner.plan({ trigger, excludedOncePerSubjectPolicies: exclusions })))
						.runs,
				).toHaveLength(2);
				const accepted = yield* planner.plan({ trigger: entityTrigger("remaining-budget") });
				expect(accepted.runs).toHaveLength(1);
				assert(accepted.trigger);
				expect(accepted.trigger.blockedReason).toBeNull();
				expect(
					(yield* session.run((db) => db.select().from(tables.automationRun)))
						.map(({ triggerId }) => triggerId)
						.sort(),
				).toEqual(["all-excluded", "all-excluded", "remaining-budget"]);
			}),
		);
	});

	layer(plannerLayer(3).pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"excludes only matching once-per-subject policies before budget counting and keeps item policies queued",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const session = yield* DatabaseSession;
					const value = eventPolicyPackage("v1", 7, "item");
					const mixed = {
						...value,
						manifest: {
							...value.manifest,
							hooks: value.manifest.hooks.map((hook) =>
								hook.stage === "before" && hook.slug === "fixture.z-first"
									? Object.assign(hook, { batchFrequency: "once-per-subject" as const })
									: hook,
							),
						},
					};
					yield* installRevisionPackage(mixed);
					const first = yield* planner.plan({
						trigger: yield* eventPolicyTrigger("first-subject-event"),
					});
					expect(first.runs).toHaveLength(2);
					const exclusions = first.runs.map(({ pluginId, hookSlug }) => ({ pluginId, hookSlug }));
					const trigger = yield* eventPolicyTrigger("second-subject-event");
					const second = yield* planner.plan({
						trigger,
						excludedOncePerSubjectPolicies: exclusions,
					});
					assert(second.trigger);
					expect(second.trigger.blockedReason).toBeNull();
					expect(second.runs.map(({ status, hookSlug }) => ({ status, hookSlug }))).toEqual([
						{ status: "queued", hookSlug: "fixture.a-second" },
					]);
					expect(second.policies).toEqual([
						{ position: 7, batchFrequency: "item", runId: second.runs[0]?.id },
					]);
					const persisted = yield* session.run((db) => db.select().from(tables.automationRun));
					expect(persisted).toHaveLength(3);
					expect(
						persisted
							.filter(({ triggerId }) => triggerId === trigger.id)
							.map(({ hookSlug }) => hookSlug),
					).toEqual(["fixture.a-second"]);
					yield* installRevisionPackage(eventPolicyPackage("v2", 99, "once-per-subject"));
					expect(
						yield* planner.plan({
							trigger,
							excludedOncePerSubjectPolicies: [...exclusions].toReversed(),
						}),
					).toEqual({ ...second, wasCreated: false });
					expect(yield* planner.plan({ trigger }).pipe(Effect.flip)).toMatchObject({
						_tag: "DbError",
					});
				}),
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"ignores exclusions for non-event policies, after hooks, and policies with omitted frequency",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const installed = yield* installRevisionPackage(hookPackage());
					const exclusions = ["fixture.a-second", "fixture.z-first", "fixture.changed"].map(
						(hookSlug) => ({
							pluginId: PluginId.make(installed.pluginId),
							hookSlug: AutomationHookSlug.make(hookSlug),
						}),
					);
					const entity = entityTrigger("entity-request", "request");
					const before = yield* planner.plan({
						trigger: entity,
						excludedOncePerSubjectPolicies: exclusions,
					});
					expect(before.runs).toHaveLength(2);
					expect(before.trigger).toEqual(entity);
					const after = yield* planner.plan({
						trigger: entityTrigger("entity-change"),
						excludedOncePerSubjectPolicies: exclusions,
					});
					expect(after.runs.map(({ hookSlug }) => hookSlug)).toEqual(["fixture.changed"]);
					const value = eventPolicyPackage("v2", 7, "item");
					yield* installRevisionPackage({
						...value,
						manifest: {
							...value.manifest,
							hooks: value.manifest.hooks.map((hook) => {
								if (hook.stage !== "before") {
									return hook;
								}
								const { batchFrequency: _frequency, ...withoutFrequency } = hook;
								return withoutFrequency;
							}),
						},
					});
					const defaultItems = yield* nested(
						planner.plan({
							excludedOncePerSubjectPolicies: exclusions,
							trigger: yield* eventPolicyTrigger("default-items"),
						}),
					);
					expect(defaultItems.runs).toHaveLength(2);
					expect(defaultItems.policies).toEqual([
						{ position: 7, runId: defaultItems.runs[0]?.id },
						{ position: 7, runId: defaultItems.runs[1]?.id },
					]);
				}),
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"matches event schema pairs, relationship deletes and provider completion, with one run for overlapping targets",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const value = revisionPackage();
					const target = {
						resource: "event" as const,
						eventSchemaSlug: "changed",
						operation: "create" as const,
						entitySchemaSlug: "fixture-entity",
					};
					yield* installRevisionPackage({
						...value,
						manifest: {
							...value.manifest,
							hooks: [
								...value.manifest.hooks,
								{
									name: "Facts",
									stage: "after",
									delivery: "async",
									slug: "fixture.facts",
									scriptSlug: "fixture.automation",
									retry: { ...DEFAULT_AUTOMATION_RETRY_POLICY, maxAttempts: 3 },
									targets: [
										target,
										target,
										{
											operation: "delete",
											resource: "relationship",
											relationshipSchemaSlug: "fixture-link",
										},
										{
											operation: "complete",
											resource: "provider-entity-import",
											entitySchemaSlug: "fixture-entity",
										},
									],
								},
							],
						},
					});
					const timestamp = "2026-09-15T00:00:00.000Z";
					for (const payload of [
						{
							resource: "event",
							category: "change",
							operation: "create",
							after: {
								id: "event",
								properties: {},
								entityId: "entity",
								createdAt: timestamp,
								updatedAt: timestamp,
								sessionEntityId: null,
								occurredAt: timestamp,
								eventSchemaSlug: "changed",
								entitySchemaSlug: "fixture-entity",
							},
						},
						{
							category: "change",
							operation: "delete",
							resource: "relationship",
							before: {
								properties: {},
								id: "relationship",
								createdAt: timestamp,
								updatedAt: timestamp,
								sourceEntityId: "source",
								targetEntityId: "target",
								relationshipSchemaSlug: "fixture-link",
							},
						},
						{
							userId: owner,
							category: "change",
							entityId: "entity",
							operation: "complete",
							externalId: "external",
							providerId: "provider",
							resource: "provider-entity-import",
							entitySchemaSlug: "fixture-entity",
						},
					] as const) {
						const trigger = yield* Schema.decodeUnknownEffect(AutomationTrigger)({
							...triggerFixture(payload.resource),
							payload,
							scopeUserId: owner,
							kind: {
								category: payload.category,
								resource: payload.resource,
								operation: payload.operation,
							},
						});
						const planned = yield* planner.plan({ trigger });
						expect(planned.runs).toHaveLength(1);
						expect(planned.trigger).toEqual(trigger);
						expect(planned.policies).toEqual([]);
						expect(planned.runs[0]).toMatchObject({
							delivery: "async",
							hookSlug: "fixture.facts",
							retryPolicy: { maxAttempts: 3 },
						});
						if (payload.resource === "event") {
							const mismatch = yield* Schema.decodeEffect(AutomationTrigger)({
								...trigger,
								id: "mismatch-event",
								payload: {
									...payload,
									after: { ...payload.after, eventSchemaSlug: "another-event" },
								},
							});
							expect(yield* planner.plan({ trigger: mismatch })).toEqual({
								runs: [],
								policies: [],
								trigger: null,
								_tag: "NoHooks",
								wasCreated: false,
							});
						}
					}
				}),
		);
	});

	layer(
		Layer.merge(plannerLayer(1), largerBudgetPlannerLayer).pipe(
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect("stores at most 100 distinct omitted hooks and accepts no partial runs", () =>
			Effect.gen(function* () {
				const planner = yield* LifecyclePlanner;
				const session = yield* DatabaseSession;
				const value = hookPackage();
				const hook = value.manifest.hooks.find(({ slug }) => slug === "fixture.changed");
				assert(hook?.stage === "after");
				yield* installRevisionPackage({
					...value,
					manifest: {
						...value.manifest,
						hooks: [
							...value.manifest.hooks.map(asAsyncDelivery),
							...Array.from({ length: 101 }, (_, index) => ({
								...hook,
								delivery: "async" as const,
								slug: `fixture.extra-${index}`,
							})),
							{ ...hook, slug: "fixture.zz-required" },
						],
					},
				});
				const bounded = entityTrigger("bounded");
				const boundedDescendant = { ...bounded, causation: { ...bounded.causation, depth: 1 } };
				const blocked = yield* planner.plan({ trigger: boundedDescendant });
				assert(blocked.trigger);
				expect(blocked).toMatchObject({
					runs: [],
					policies: [],
					trigger: { blockedReason: { hasRequiredHooks: true } },
				});
				const [trigger] = yield* session.run((db) =>
					db
						.select()
						.from(tables.automationTrigger)
						.where(eq(tables.automationTrigger.id, "bounded")),
				);
				expect(trigger?.blockedReason?.omittedHooks).toHaveLength(100);
				expect(blocked.trigger.blockedReason).toEqual(trigger?.blockedReason);
				expect(
					blocked.trigger.blockedReason?.omittedHooks.some(
						({ hookSlug }) => hookSlug === "fixture.zz-required",
					),
				).toBe(false);
				const asyncVersion = hookPackage("v2");
				yield* installRevisionPackage({
					...asyncVersion,
					manifest: {
						...asyncVersion.manifest,
						hooks: asyncVersion.manifest.hooks.map(asAsyncDelivery),
					},
				});
				expect(yield* planner.plan({ trigger: boundedDescendant })).toEqual({
					...blocked,
					wasCreated: false,
				});
				const replayWithLargerBudget = yield* (yield* LargerBudgetPlanner).plan({
					trigger: boundedDescendant,
				});
				expect(replayWithLargerBudget).toEqual({ ...blocked, wasCreated: false });
				expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual([]);
			}),
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"returns pinned event policy batch declarations without requiring domain manifest reads",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					yield* installRevisionPackage(eventPolicyPackage("v1", 7, "once-per-subject"));
					const trigger = yield* eventPolicyTrigger();
					const first = yield* planner.plan({ trigger });
					expect(first.trigger).toEqual({
						...trigger,
						payload: { ...trigger.payload, excludedOncePerSubjectPolicies: [] },
					});
					expect(first.policies).toEqual([
						{ position: 7, runId: first.runs[0]?.id, batchFrequency: "once-per-subject" },
						{ position: 7, runId: first.runs[1]?.id, batchFrequency: "once-per-subject" },
					]);
					expect(first.runs.map(({ hookSlug }) => hookSlug)).toEqual([
						"fixture.a-second",
						"fixture.z-first",
					]);
					const second = yield* planner.plan({
						trigger: { ...trigger, id: AutomationTriggerId.make("second-event-policy") },
					});
					expect(second.policies.map(({ batchFrequency }) => batchFrequency)).toEqual([
						"once-per-subject",
						"once-per-subject",
					]);
					expect(second.runs.map(({ pluginId, hookSlug }) => ({ pluginId, hookSlug }))).toEqual(
						first.runs.map(({ pluginId, hookSlug }) => ({ pluginId, hookSlug })),
					);
					yield* installRevisionPackage(eventPolicyPackage("v2", 99, "item"));
					expect(yield* planner.plan({ trigger })).toEqual({ ...first, wasCreated: false });
					const fresh = yield* nested(
						planner.plan({
							trigger: { ...trigger, id: AutomationTriggerId.make("new-event-policy") },
						}),
					);
					expect(
						fresh.policies.map(({ position, batchFrequency }) => ({ position, batchFrequency })),
					).toEqual([
						{ position: 99, batchFrequency: "item" },
						{ position: 99, batchFrequency: "item" },
					]);
				}),
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"matches snapshots and stages, orders policies, snapshots delivery/retry and preserves pins on replay after upgrade",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const session = yield* DatabaseSession;
					const installed = yield* installRevisionPackage(hookPackage());
					const policies = yield* planner.plan({ trigger: entityTrigger("request", "request") });
					expect(
						policies.runs.map(({ hookSlug, delivery, retryPolicy }) => ({
							hookSlug,
							delivery,
							retryPolicy,
						})),
					).toEqual([
						{ retryPolicy: null, delivery: "policy", hookSlug: "fixture.z-first" },
						{ retryPolicy: null, delivery: "policy", hookSlug: "fixture.a-second" },
					]);
					expect(policies.policies).toEqual([
						{ position: -1, runId: policies.runs[0]?.id },
						{ position: 1000, runId: policies.runs[1]?.id },
					]);
					for (const operation of ["create", "update", "delete"] as const) {
						const planned = yield* planner.plan({
							trigger: entityTrigger(operation, "change", operation),
						});
						expect(planned.runs).toHaveLength(1);
						expect(planned.runs[0]).toMatchObject({
							delivery: "required",
							executionUserId: owner,
							pluginId: installed.pluginId,
							pluginRevisionId: installed.revisionId,
							retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
							artifactsExpireAt: "2026-09-22T00:00:00.000Z",
						});
						assert(planned.runs[0]);
						expect(planned.runs[0].id).toBe(lifecycleRunId(planned.runs[0]));
					}
					const original = yield* planner.plan({ trigger: entityTrigger("create") });
					yield* installRevisionPackage(hookPackage("v2"));
					expect(yield* planner.plan({ trigger: entityTrigger("create") })).toEqual({
						...original,
						wasCreated: false,
					});
					const next = yield* nested(planner.plan({ trigger: entityTrigger("new") }));
					expect(next.runs[0]?.pluginRevisionId).not.toBe(original.runs[0]?.pluginRevisionId);
					expect(next.runs[0]?.sandboxScriptId).not.toBe(original.runs[0]?.sandboxScriptId);
					expect(next.runs[0]?.pluginConfigRevisionId).not.toBe(
						original.runs[0]?.pluginConfigRevisionId,
					);
					const filtered = entityTrigger("filtered");
					expect(
						yield* planner.plan({
							trigger: { ...filtered, causation: { ...filtered.causation, source: "bootstrap" } },
						}),
					).toEqual({ runs: [], policies: [], trigger: null, _tag: "NoHooks", wasCreated: false });
					expect(
						yield* session.run((db) =>
							db
								.select()
								.from(tables.automationTrigger)
								.where(eq(tables.automationTrigger.id, "filtered")),
						),
					).toHaveLength(0);
					expect(
						yield* planner
							.plan({
								trigger: { ...entityTrigger("create"), occurredAt: "2026-09-16T00:00:00.000Z" },
							})
							.pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
				}),
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"filters hidden, unready, tombstoned, wrong-scope and mismatched configuration without activating config",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const session = yield* DatabaseSession;
					const installed = yield* installRevisionPackage(hookPackage(), owner);
					const ready = yield* planner.plan({ trigger: entityTrigger("ready") });
					expect(ready.runs).toHaveLength(1);
					const activeConfigRevisionId = ready.runs[0]?.pluginConfigRevisionId;
					assert(activeConfigRevisionId);
					expect(
						yield* planner.plan({ trigger: { ...entityTrigger("other"), scopeUserId: recipient } }),
					).toMatchObject({ runs: [], policies: [] });
					expect(
						yield* planner.plan({ trigger: { ...entityTrigger("global"), scopeUserId: null } }),
					).toMatchObject({ runs: [], policies: [] });
					for (const [id, state] of [
						["hidden", { isHidden: true }],
						["unready", { isHidden: false, health: "needs-configuration" as const }],
						[
							"tombstone",
							{
								health: "ready" as const,
								uninstalledAt: DateTime.toDate(DateTime.makeUnsafe("2026-09-15T00:00:00Z")),
							},
						],
						["no-config", { uninstalledAt: null, activeConfigRevisionId: null }],
					] as const) {
						yield* session.run((db) =>
							db
								.update(tables.pluginInstallation)
								.set(state)
								.where(eq(tables.pluginInstallation.id, installed.installation.id)),
						);
						expect(yield* nested(planner.plan({ trigger: entityTrigger(id) }))).toMatchObject({
							runs: [],
							policies: [],
						});
					}
					const configs = yield* session.run((db) => db.select().from(tables.pluginConfigRevision));
					expect(configs).toHaveLength(1);
					const [state] = yield* session.run((db) =>
						db
							.select()
							.from(tables.pluginInstallation)
							.where(eq(tables.pluginInstallation.id, installed.installation.id)),
					);
					expect(state?.activeConfigRevisionId).toBeNull();
					yield* installRevisionPackage(hookPackage("v2"), owner);
					yield* session.run((db) =>
						db
							.update(tables.pluginInstallation)
							.set({ activeConfigRevisionId })
							.where(eq(tables.pluginInstallation.id, installed.installation.id)),
					);
					expect(yield* nested(planner.plan({ trigger: entityTrigger("mismatch") }))).toMatchObject(
						{ runs: [], policies: [] },
					);
					expect(yield* planner.plan({ trigger: entityTrigger("ready") })).toEqual({
						...ready,
						wasCreated: false,
					});
				}),
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"plans notifications once per preferred hook/user, deduplicates actor and verifies recipient replay",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const session = yield* DatabaseSession;
					const installations = yield* PluginInstallationRepository;
					const installed = yield* installRevisionPackage(revisionPackage());
					yield* installations.upsertState({
						config: {},
						sortOrder: 0,
						health: "ready",
						isHidden: false,
						userId: recipient,
						pluginId: installed.pluginId,
					});
					yield* session.run((db) =>
						db
							.insert(tables.notificationSubscription)
							.values(
								[owner, recipient].map((userId) => ({
									userId,
									signalSchemaSlug: "fixture.signal",
									signalSchemaPluginId: installed.pluginId,
								})),
							),
					);
					const trigger = triggerFixture("trigger-test", PluginId.make(installed.pluginId));
					const planned = yield* planner.plan({
						trigger,
						recipients: [recipient, owner, recipient],
					});
					expect(planned.runs.map(({ executionUserId }) => executionUserId)).toEqual([
						owner,
						recipient,
					]);
					expect(new Set(planned.runs.map(({ id }) => id)).size).toBe(2);
					yield* session.run((db) =>
						db.update(tables.notificationSubscription).set({ isActive: false }),
					);
					expect(planned.wasCreated).toBe(true);
					expect(yield* planner.plan({ trigger, recipients: [owner, recipient] })).toEqual({
						...planned,
						wasCreated: false,
					});
					expect(
						yield* planner.plan({
							recipients: [recipient],
							trigger: triggerFixture("inactive", PluginId.make(installed.pluginId)),
						}),
					).toMatchObject({ runs: [], policies: [] });
					expect(yield* planner.plan({ trigger, recipients: [] })).toEqual({
						...planned,
						wasCreated: false,
					});
					expect(
						(yield* session.run((db) =>
							db
								.select()
								.from(tables.automationTriggerRecipient)
								.where(eq(tables.automationTriggerRecipient.triggerId, trigger.id)),
						))
							.map(({ userId }) => userId)
							.sort(),
					).toEqual([owner, recipient]);
				}),
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"pins source-zero notification to the current kernel hash, including a revert to old code",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const plugins = yield* PluginRepository;
					const session = yield* DatabaseSession;
					yield* seedKernelDefinitions();
					const script = {
						source: "v1",
						name: "Notify",
						compiledFormat: 1,
						compiledCode: "v1",
						contentHash: "kernel-v1",
						slug: "automation.notification",
						metadata: {
							name: "Notify",
							capabilities: [],
							kind: "automation" as const,
							requiredPluginConfigKeys: [],
							requiredSystemConfigKeys: [],
							slug: "automation.notification",
							automationType: "automation" as const,
							inputProjection: { signal: { properties: ["providerName"] } },
						},
					};
					yield* plugins.persistKernelScript(script);
					yield* plugins.persistKernelScript({
						...script,
						source: "v2",
						compiledCode: "v2",
						contentHash: "kernel-v2",
					});
					yield* plugins.persistKernelScript(script);
					yield* session.run((db) =>
						db
							.insert(tables.notificationSubscription)
							.values({
								userId: owner,
								signalSchemaPluginId: null,
								signalSchemaSlug: "integration.disabled",
							}),
					);
					const trigger = triggerFixture("kernel");
					assert(trigger.payload?.resource === "signal");
					const planned = yield* planner.plan({
						trigger: yield* Schema.decodeEffect(AutomationTrigger)({
							...trigger,
							payload: {
								...trigger.payload,
								signalSchemaPluginId: null,
								signalSchemaSlug: "integration.disabled",
							},
						}),
					});
					expect(planned.runs).toHaveLength(1);
					expect(planned.runs[0]).toMatchObject({
						pluginId: null,
						pluginRevisionId: null,
						executionUserId: owner,
						pluginConfigRevisionId: null,
						scriptContentHash: "kernel-v1",
						hookSlug: "automation.notification",
					});
				}),
		);
	});

	layer(
		Layer.merge(plannerLayer(2), AutomationTriggerRepository.layer).pipe(
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect(
			"blocks whole fan-outs and depth, preserves blocked replay, and rolls source writes back on planning failure",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const triggers = yield* AutomationTriggerRepository;
					const session = yield* DatabaseSession;
					yield* installRevisionPackage(hookPackage());
					const firstTrigger = asDescendant(entityTrigger("first"));
					const first = yield* planner.plan({ trigger: firstTrigger });
					expect(first.runs).toHaveLength(1);
					expect(yield* planner.plan({ trigger: firstTrigger })).toEqual({
						...first,
						wasCreated: false,
					});
					const request = asDescendant(entityTrigger("blocked", "request"));
					const blocked = yield* planner.plan({ trigger: request });
					assert(blocked.trigger);
					expect(blocked).toMatchObject({ runs: [], policies: [] });
					expect(blocked.trigger.blockedReason).toMatchObject({
						hasRequiredHooks: false,
						code: "automation-limit-reached",
						omittedHooks: [{ hookSlug: "fixture.z-first" }, { hookSlug: "fixture.a-second" }],
					});
					expect(yield* planner.plan({ trigger: request })).toEqual({
						...blocked,
						wasCreated: false,
					});
					const deep = entityTrigger("deep");
					const deepPlan = yield* planner.plan({
						trigger: { ...deep, causation: { ...deep.causation, depth: 3 } },
					});
					expect(deepPlan).toMatchObject({
						runs: [],
						policies: [],
						trigger: {
							blockedReason: { hasRequiredHooks: true, code: "automation-limit-reached" },
						},
					});
					const failed = yield* (yield* DatabaseSession)
						.transaction(
							Effect.gen(function* () {
								yield* (yield* DatabaseSession).run((db) =>
									db
										.update(tables.user)
										.set({ name: "must roll back" })
										.where(eq(tables.user.id, owner)),
								);
								yield* planner.plan({ trigger: entityTrigger("rollback") });
								return yield* planner.plan({
									trigger: { ...firstTrigger, scopeUserId: recipient },
								});
							}),
						)
						.pipe(Effect.flip);
					expect(failed).toMatchObject({ _tag: "DbError" });
					expect(yield* triggers.findById(AutomationTriggerId.make("rollback"))).toBeNull();
					const [user] = yield* session.run((db) =>
						db.select().from(tables.user).where(eq(tables.user.id, owner)),
					);
					expect(user?.name).toBe("Owner");
				}),
		);
	});
	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect("plans an after hook only for the execution scope it declares", () =>
			Effect.gen(function* () {
				const planner = yield* LifecyclePlanner;
				const globalTrigger = (id: string) => ({ ...entityTrigger(id), scopeUserId: null });
				yield* installRevisionPackage(afterHookPackage("v1", { executionScope: "user" }));
				expect((yield* planner.plan({ trigger: entityTrigger("user-a") })).runs).toHaveLength(1);
				expect((yield* planner.plan({ trigger: globalTrigger("global-a") })).runs).toEqual([]);
				yield* installRevisionPackage(afterHookPackage("v2", { executionScope: "global" }));
				expect((yield* nested(planner.plan({ trigger: entityTrigger("user-b") }))).runs).toEqual(
					[],
				);
				expect(
					(yield* nested(planner.plan({ trigger: globalTrigger("global-b") }))).runs,
				).toHaveLength(1);
			}),
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect("matches item hooks to item triggers and batch hooks to batch triggers", () =>
			Effect.gen(function* () {
				const planner = yield* LifecyclePlanner;
				const items = [entityChange("entity-1"), entityChange("entity-2")];
				yield* installRevisionPackage(hookPackage());
				expect((yield* planner.plan({ trigger: entityTrigger("item") })).runs).toHaveLength(1);
				expect((yield* planner.plan({ trigger: entityBatchTrigger("batch", items) })).runs).toEqual(
					[],
				);
				yield* installRevisionPackage(afterHookPackage("v2", { frequency: "batch" }));
				expect((yield* nested(planner.plan({ trigger: entityTrigger("item-2") }))).runs).toEqual(
					[],
				);
				expect(
					(yield* nested(planner.plan({ trigger: entityBatchTrigger("batch-2", items) }))).runs,
				).toHaveLength(1);
				expect(
					(yield* nested(
						planner.plan({
							trigger: entityBatchTrigger("batch-partial", [
								entityChange("other", "absent-entity"),
								entityChange("entity-3"),
							]),
						}),
					)).runs,
				).toHaveLength(1);
				expect(
					(yield* nested(
						planner.plan({
							trigger: entityBatchTrigger("batch-none", [entityChange("other", "absent-entity")]),
						}),
					)).runs,
				).toEqual([]);
			}),
		);
	});

	layer(plannerLayer(100, 2).pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect(
			"retains a pending batch hook's script and configuration through revision pruning",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const session = yield* DatabaseSession;
					const plugins = yield* PluginRepository;
					const receipts = yield* MutationReceipts.make;
					const installed = yield* installRevisionPackage(
						afterHookPackage("v1", { frequency: "batch" }),
						owner,
					);
					const input = {
						identity: ["pinned"],
						resource: "entity" as const,
						command: {
							itemIdentity: "pinned",
							occurredAt: "2026-09-15T00:00:00.000Z",
							causation: triggerFixture("pinned").causation,
							accountGeneration: { userId: owner, token: "test-account-generation" },
						},
					};
					const decision = yield* nested(planner.prepareBatch({ ...input, scopes: [owner] }));
					expect(decision.hasCandidates).toBe(true);
					const [pin] = yield* session.run((db) =>
						db
							.select()
							.from(tables.mutationReceipt)
							.where(eq(tables.mutationReceipt.receiptType, "batch-candidate")),
					);
					const configId = pin?.pluginConfigRevisionId;
					const scriptId = pin?.sandboxScriptId;
					assert(pin && configId && scriptId);
					expect(pin.pluginRevisionId).toBe(installed.revisionId);
					yield* installRevisionPackage(afterHookPackage("v2", { frequency: "batch" }), owner);
					const expiry = DateTime.toDateUtc(DateTime.makeUnsafe("2027-01-01T00:00:00.000Z"));
					yield* plugins.pruneRevisionArtifacts({ limit: 100, now: expiry, retryWindowDays: 7 });
					yield* plugins.deleteUnreferencedScripts(new Set(), { limit: 100, now: expiry });
					const [config] = yield* session.run((db) =>
						db
							.select()
							.from(tables.pluginConfigRevision)
							.where(eq(tables.pluginConfigRevision.id, configId)),
					);
					const [script] = yield* session.run((db) =>
						db.select().from(tables.sandboxScript).where(eq(tables.sandboxScript.id, scriptId)),
					);
					assert(config && script);
					expect(config.encryptedPayload).not.toBeNull();
					expect(script.id).toBe(pin.sandboxScriptId);
					expect((yield* nested(planner.prepareBatch({ ...input, scopes: [owner] }))).id).toBe(
						decision.id,
					);
					yield* nested(
						Effect.gen(function* () {
							yield* receipts.insert({
								dispatch: [],
								batchIndex: 0,
								batchId: decision.id,
								result: { id: "first" },
								evidence: yield* Schema.decodeEffect(AutomationEntityChangePayload)(
									entityChange("first"),
								),
								identity: mutationReceiptIdentity({
									ownerUserId: owner,
									scopeUserId: owner,
									input: { id: "first" },
									commandKind: "entity:create",
									command: { ...input.command, itemIdentity: "pinned:item" },
								}),
							});
						}),
					);
					const dispatch = yield* nested(planner.planBatch(input));
					expect(dispatch).toHaveLength(1);
					const [run] = yield* session.run((db) => db.select().from(tables.automationRun));
					expect(run?.pluginRevisionId).toBe(installed.revisionId);
					expect(run?.pluginConfigRevisionId).toBe(pin.pluginConfigRevisionId);
					expect(yield* nested(planner.planBatch(input))).toEqual(dispatch);
					expect(
						(yield* session.run((db) => db.select().from(tables.mutationReceipt))).filter(
							({ evidence, receiptType }) => receiptType === "batch-candidate" || evidence !== null,
						),
					).toEqual([]);
				}),
		);
	});
	layer(plannerLayer(100, 2).pipe(Layer.provideMerge(revisionDatabaseLayer)))((test) => {
		test.effect("refuses to seal a batch whose pinned candidate was lost", () =>
			Effect.gen(function* () {
				const planner = yield* LifecyclePlanner;
				const session = yield* DatabaseSession;
				yield* installRevisionPackage(afterHookPackage("v1", { frequency: "batch" }));
				const input = {
					identity: ["lost-pin"],
					resource: "entity" as const,
					command: {
						itemIdentity: "lost-pin",
						occurredAt: "2026-09-15T00:00:00.000Z",
						causation: triggerFixture("unused").causation,
						accountGeneration: { userId: owner, token: "test-account-generation" },
					},
				};
				expect(
					(yield* nested(planner.prepareBatch({ ...input, scopes: [owner] }))).hasCandidates,
				).toBe(true);
				yield* session.run((db) =>
					db
						.delete(tables.mutationReceipt)
						.where(eq(tables.mutationReceipt.receiptType, "batch-candidate")),
				);
				const failure = yield* nested(planner.planBatch(input)).pipe(Effect.flip);
				expect(failure.message).toContain("Missing pinned batch hooks");
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
			}),
		);
		test.effect(
			"chunks receipt evidence for batch-only hooks and seals pinned runs on replay",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const session = yield* DatabaseSession;
					const receipts = yield* MutationReceipts.make;
					yield* installRevisionPackage(afterHookPackage("v1", { frequency: "batch" }));
					const input = {
						resource: "entity" as const,
						identity: ["children", "entity"],
						command: {
							itemIdentity: "population",
							occurredAt: "2026-09-15T00:00:00.000Z",
							causation: triggerFixture("unused").causation,
							accountGeneration: { userId: owner, token: "test-account-generation" },
						},
					};
					const chunked = yield* nested(
						Effect.gen(function* () {
							const decision = yield* planner.prepareBatch({ ...input, scopes: [owner] });
							expect(decision.hasCandidates).toBe(true);
							for (const [index, id] of ["first", "second", "third"].entries()) {
								yield* receipts.insert({
									dispatch: [],
									result: { id },
									batchIndex: index,
									batchId: decision.id,
									evidence: yield* Schema.decodeEffect(AutomationEntityChangePayload)(
										entityChange(id),
									),
									identity: mutationReceiptIdentity({
										input: { id },
										ownerUserId: owner,
										scopeUserId: owner,
										commandKind: "entity:create",
										command: {
											...input.command,
											itemIdentity: `${input.command.itemIdentity}:${id}`,
										},
									}),
								});
							}
							return yield* planner.planBatch(input);
						}),
					);
					expect(chunked).toHaveLength(2);
					const triggers = yield* session.run((db) =>
						db
							.select({
								id: tables.automationTrigger.id,
								payload: tables.automationTrigger.payload,
							})
							.from(tables.automationTrigger),
					);
					expect(
						triggers
							.flatMap(({ payload }) =>
								payload?.operation === "batch" ? [payload.items.length] : [],
							)
							.sort((left, right) => left - right),
					).toEqual([1, 2]);
					expect(chunked.flatMap(({ runs }) => runs)).toHaveLength(2);
					const replay = yield* nested(planner.planBatch(input));
					expect(replay).toEqual(chunked);
					const rows = yield* session.run((db) => db.select().from(tables.mutationReceipt));
					expect(
						rows.filter((row) => row.receiptType === "batch-candidate" || row.evidence !== null),
					).toEqual([]);
				}),
		);
	});
});
