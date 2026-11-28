import { describe, expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationEntityChangePayload,
	AutomationEventChangePayload,
	AutomationPolicyBatchInput,
	AutomationRequestPayload,
	AutomationTrigger,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { CommittedChanges } from "@ryot-app/contract/modules/changes/change-set";
import { type PluginHookTarget, PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationHookSlug,
	AutomationTriggerId,
	PluginId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { PluginPackageId } from "@ryot-app/contract/schema/brands";
import {
	emptySandboxExecutionMetadata,
	fixtureManifest,
	testPluginPackageId,
} from "@ryot-app/contract/testing";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { makeRecordingTracer, recordedStatements } from "@ryot-app/testing/recording-tracer";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Ref, Schema, type Tracer } from "effect";

import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	type LifecycleBatchInput,
	LifecyclePlanner,
	lifecycleRunId,
	toLifecycleDispatchPlan,
} from "#modules/automations/lifecycle/planning";
import { LifecyclePolicies } from "#modules/automations/lifecycle/policies";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { seedKernelDefinitions } from "#modules/definitions/test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import type { CommitReceipt } from "#modules/mutations/idempotency";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	installRevisionPackage,
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import {
	scriptCallResult,
	scriptCallsLayer,
	unavailableScriptCallsLayer,
} from "#modules/scripts/executions/calls.test-support";
import { ScriptChanges, type ScriptChangesInput } from "#modules/scripts/executions/script-changes";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { WriteTransaction } from "#platform/db/write-transaction";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";

import { automationAttemptIdentity } from "./attempt-repository";
import { AutomationExecutionOperationsLive, LifecycleExecutionLive } from "./execution";
import {
	AutomationRunOperationsServiceLive,
	LifecyclePlannerServiceLive,
	LifecyclePoliciesServiceLive,
} from "./layer";
import {
	noLifecycleWorkLayer,
	policyFixture,
	policyRequestFixture,
	triggerFixture,
} from "./lifecycle.test-support";
import { LifecyclePlannerLive } from "./planner";
import { AutomationPlannerResolver } from "./planner-resolver";
import { LifecyclePoliciesLive } from "./policies";
import { AutomationRunOperations } from "./run-job-live";
import { recordingRunJobQueueLayer, RunJobSubmissions } from "./run-job-queue.test-support";
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
		Layer.provide(noLifecycleWorkLayer),
		Layer.provide(
			makeAppConfigLayer({
				automations: { maxRuns, maxDepth: 2, batchMaxItems, retryWindowDays: 7 },
			}),
		),
	);
class LargerBudgetPlanner extends Context.Service<
	LargerBudgetPlanner,
	LifecyclePlanner["Service"]
>()("@ryot-app/kernel-backend/modules/automations/planner.test/LargerBudgetPlanner") {}

const largerBudgetPlannerLayer = Layer.effect(
	LargerBudgetPlanner,
	Effect.service(LifecyclePlanner),
).pipe(Layer.provide(plannerLayer(10000)));
const asDescendant = <T extends Effect.Success<ReturnType<typeof entityTrigger>>>(trigger: T) => ({
	...trigger,
	causation: { ...trigger.causation, depth: 1 },
});
const entityTrigger = (
	pluginId: null | string,
	id = "entity",
	operation: "create" | "update" | "delete" = "create",
) => {
	const snapshot = {
		id: "entity",
		name: "Entity",
		properties: {},
		externalId: null,
		providerId: null,
		populatedAt: null,
		entitySchemaPluginId: pluginId,
		entitySchemaSlug: "fixture-entity",
		createdAt: "2026-09-15T00:00:00.000Z",
		updatedAt: "2026-09-15T00:00:00.000Z",
	};
	const change =
		operation === "delete"
			? { before: snapshot }
			: { after: snapshot, ...(operation === "update" ? { before: snapshot } : {}) };
	return Schema.decodeUnknownEffect(AutomationTrigger)({
		...triggerFixture(id),
		scopeUserId: owner,
		kind: { operation, category: "change", resource: "entity" },
		payload: { ...change, operation, category: "change", resource: "entity" },
	}).pipe(Effect.orDie);
};

const entityChange = (
	pluginId: null | string,
	id: string,
	entitySchemaSlug = "fixture-entity",
) => ({
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
		entitySchemaPluginId: pluginId,
		createdAt: "2026-09-15T00:00:00.000Z",
		updatedAt: "2026-09-15T00:00:00.000Z",
	},
});
const eventChange = (pluginId: null | string, id: string, eventSchemaSlug = "changed") =>
	Schema.decodeEffect(AutomationEventChangePayload)({
		resource: "event",
		category: "change",
		operation: "create",
		after: {
			id,
			properties: {},
			eventSchemaSlug,
			sessionEntityId: null,
			entityId: "event-entity",
			eventSchemaPluginId: pluginId,
			entitySchemaPluginId: pluginId,
			entitySchemaSlug: "fixture-entity",
			createdAt: "2026-09-15T00:00:00.000Z",
			updatedAt: "2026-09-15T00:00:00.000Z",
			occurredAt: "2026-09-15T00:00:00.000Z",
		},
	}).pipe(Effect.orDie);
const eventTarget = (eventSchemaSlug: string): PluginHookTarget => ({
	eventSchemaSlug,
	resource: "event",
	operation: "create",
	entitySchemaSlug: "fixture-entity",
});
const entityBatchTrigger = (id: string, items: ReadonlyArray<ReturnType<typeof entityChange>>) =>
	Schema.decodeEffect(AutomationTrigger)({
		...triggerFixture(id),
		scopeUserId: owner,
		kind: { category: "change", operation: "batch", resource: "entity" },
		payload: { items, category: "change", operation: "batch", resource: "entity" },
	}).pipe(Effect.orDie);

const hookPackage = (
	version = "v1",
	packageId: PluginPackageId = fixtureManifest().metadata.packageId,
) => {
	const value = revisionPackage("fixture", version, "fixture-entity", packageId);
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
					scriptSlug: "fixture.automation",
					causationSources: ["api" as const],
				},
			],
		},
	};
};

const afterHookPackage = (
	version: string,
	addition: {
		batchMaxItems?: number;
		frequency?: "item" | "batch";
		executionScope?: "user" | "global";
	},
	packageId?: PluginPackageId,
) => {
	const value = hookPackage(version, packageId);
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
	batchFrequency: "item" | "once-per-subject",
	packageId?: PluginPackageId,
) => {
	const value = hookPackage(version, packageId);
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
const eventPolicyRequest = (pluginId: null | string) =>
	Schema.decodeEffect(AutomationRequestPayload)({
		resource: "event",
		category: "request",
		operation: "create",
		draft: {
			properties: {},
			entityId: "subject",
			sessionEntityId: null,
			eventSchemaSlug: "changed",
			eventSchemaPluginId: pluginId,
			entitySchemaPluginId: pluginId,
			entitySchemaSlug: "fixture-entity",
			occurredAt: "2026-09-15T00:00:00.000Z",
		},
	}).pipe(Effect.orDie);

describe("LifecyclePlanner PostgreSQL", () => {
	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"materializes shared recipient hooks once, queued at planning time, with ordered identities, pins and redaction",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const source = revisionPackage();
						const [hook] = source.manifest.hooks;
						assert(hook);
						const installed = yield* installRevisionPackage({
							...source,
							manifest: {
								...source.manifest,
								hooks: [
									hook,
									...["z-last", "a-first", "m-middle"].map((slug) =>
										Object.assign({}, hook, { slug }),
									),
								],
								signalSchemas: source.manifest.signalSchemas.map((signal) =>
									Object.assign({}, signal, {
										propertiesSchema: {
											fields: {
												visible: {
													type: "string",
													description: "Public field",
													label: { key: "test.visible" },
												},
												secret: {
													secret: true,
													type: "string",
													description: "Private field",
													label: { key: "test.secret" },
												},
											},
										},
									}),
								),
							},
						});
						yield* (yield* PluginInstallationRepository).upsertState({
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
						const base = triggerFixture("set-planning", PluginId.make(installed.pluginId));
						assert(base.payload?.resource === "signal");
						const trigger = {
							...base,
							payload: { ...base.payload, properties: { visible: "kept", secret: "hidden" } },
						};
						const spans: Tracer.Span[] = [];
						const plannedAt = DateTime.formatIso(yield* DateTime.now);
						const planned = yield* nested(
							planner.plan({
								trigger,
								transaction: new WriteTransaction(),
								recipients: [recipient, owner, recipient],
							}),
						).pipe(Effect.withTracer(makeRecordingTracer(spans)));
						const statements = recordedStatements(spans);
						expect(
							statements.filter((text) => text.includes('from "sandbox_script"')),
						).toHaveLength(1);
						expect(
							statements.filter((text) => text.includes('from "plugin_revision"')),
						).toHaveLength(2);
						expect(
							statements.filter((text) => text.startsWith('insert into "automation_run"')),
						).toHaveLength(1);
						expect(
							statements.filter(
								(text) => text.includes('from "automation_run"') && !text.includes("count("),
							),
						).toHaveLength(1);
						const catalogs = yield* (yield* DefinitionCatalog).listUserPlugins(sql`true`);
						const scripts = yield* session.run((db) =>
							db
								.select()
								.from(tables.sandboxScript)
								.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId)),
						);
						const script = scripts.find(({ slug }) => slug === "fixture.automation");
						assert(script);
						const expected = ["a-first", "fixture.notify", "m-middle", "z-last"].flatMap((slug) =>
							[owner, recipient].map((executionUserId) => ({
								hookSlug: slug,
								executionUserId,
								sandboxScriptId: script.id,
								scriptContentHash: script.contentHash,
								pluginRevisionId: installed.revisionId,
								pluginConfigRevisionId: catalogs.find(
									(catalog) =>
										catalog.userId === executionUserId && catalog.pluginId === installed.pluginId,
								)?.configRevisionId,
								id: lifecycleRunId({
									executionUserId,
									triggerId: trigger.id,
									hookSlug: AutomationHookSlug.make(slug),
									pluginId: PluginId.make(installed.pluginId),
								}),
							})),
						);
						expect(planned.runs).toHaveLength(expected.length);
						expect(planned.runs).toMatchObject(expected);
						expect(plannedAt).not.toBe(trigger.createdAt);
						expect(new Set(planned.runs.map(({ queuedAt }) => queuedAt))).toEqual(
							new Set([plannedAt]),
						);
						const rows = yield* session.run((db) =>
							db
								.select()
								.from(tables.automationRun)
								.where(eq(tables.automationRun.triggerId, trigger.id)),
						);
						for (const row of rows) {
							expect(row.historyPayload).toEqual<unknown>({
								...trigger.payload,
								properties: { visible: "kept" },
							});
							expect(row.historyPayloadTruncated).toBe(false);
						}
						expect(
							yield* nested(
								planner.plan({
									trigger,
									recipients: [recipient],
									transaction: new WriteTransaction(),
								}),
							),
						).toEqual({ ...planned, wasCreated: false });
					}),
				testTimeout,
			);
		},
	);
	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"ignores unselected missing artifacts and rolls back when a selected artifact is absent",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const installed = yield* installRevisionPackage(hookPackage());
						yield* session.run((db) =>
							db
								.delete(tables.sandboxScript)
								.where(eq(tables.sandboxScript.slug, "fixture.policy")),
						);
						const accepted = yield* nested(
							planner.plan({
								transaction: new WriteTransaction(),
								trigger: yield* entityTrigger(installed.pluginId, "unselected-missing"),
							}),
						);
						expect(accepted.runs.map(({ hookSlug }) => hookSlug)).toEqual<unknown>([
							"fixture.changed",
						]);
						yield* session.run((db) =>
							Effect.gen(function* () {
								yield* db.delete(tables.automationRun);
								yield* db
									.delete(tables.sandboxScript)
									.where(eq(tables.sandboxScript.slug, "fixture.automation"));
							}),
						);
						const failed = yield* nested(
							Effect.gen(function* () {
								yield* session.run((db) =>
									db
										.update(tables.user)
										.set({ name: "must roll back" })
										.where(eq(tables.user.id, owner)),
								);
								return yield* planner.plan({
									transaction: new WriteTransaction(),
									trigger: yield* entityTrigger(installed.pluginId, "selected-missing"),
								});
							}),
						).pipe(Effect.exit);
						assertExitFails(
							failed,
							new DbError({
								message: `Missing automation script ${installed.pluginId}/fixture.changed`,
							}),
						);
						expect(
							yield* session.run((db) =>
								db
									.select({ name: tables.user.name })
									.from(tables.user)
									.where(eq(tables.user.id, owner)),
							),
						).toEqual([{ name: "Owner" }]);
						expect(
							yield* session.run((db) =>
								db
									.select()
									.from(tables.automationTrigger)
									.where(eq(tables.automationTrigger.id, "selected-missing")),
							),
						).toEqual([]);
					}),
				testTimeout,
			);
		},
	);
	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"keys shared batch script metadata by revision and reuses it only within the transaction",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const first = yield* installRevisionPackage(
							afterHookPackage("v1", { frequency: "batch" }, testPluginPackageId()),
						);
						const second = yield* installRevisionPackage(
							afterHookPackage("v2", { frequency: "batch" }, testPluginPackageId()),
						);
						const resolver = yield* AutomationPlannerResolver.make;
						const spans: Tracer.Span[] = [];
						const transaction = new WriteTransaction();
						const pins = yield* nested(
							Effect.gen(function* () {
								yield* resolver.lockCatalog([owner], transaction);
								const selected = yield* resolver.resolveBatchCandidates({
									transaction,
									userId: owner,
									source: "api",
									resource: "entity",
								});
								expect(
									yield* resolver.resolveBatchCandidates({
										transaction,
										userId: owner,
										source: "api",
										resource: "entity",
									}),
								).toEqual(selected);
								return selected;
							}),
						).pipe(Effect.withTracer(makeRecordingTracer(spans)));
						expect(
							recordedStatements(spans).filter((text) => text.includes('from "sandbox_script"')),
						).toHaveLength(1);
						expect(pins).toHaveLength(2);
						for (const installed of [first, second]) {
							const scripts = yield* session.run((db) =>
								db
									.select()
									.from(tables.sandboxScript)
									.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId)),
							);
							const script = scripts.find(({ slug }) => slug === "fixture.automation");
							assert(script);
							expect(
								pins.find(({ references }) => references.pluginId === installed.pluginId),
							).toMatchObject({
								references: { sandboxScriptId: script.id, pluginRevisionId: installed.revisionId },
								payload: {
									scriptSlug: "fixture.automation",
									scriptContentHash: script.contentHash,
								},
							});
						}
						const fresh: Tracer.Span[] = [];
						yield* nested(
							resolver.resolveBatchCandidates({
								userId: owner,
								source: "api",
								resource: "entity",
								transaction: new WriteTransaction(),
							}),
						).pipe(Effect.withTracer(makeRecordingTracer(fresh)));
						expect(
							recordedStatements(fresh).filter((text) => text.includes('from "sandbox_script"')),
						).toHaveLength(1);
					}),
				testTimeout,
			);
		},
	);
	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"shares one reading of the user's plugins among the callers that name its transaction",
				() =>
					Effect.gen(function* () {
						yield* installRevisionPackage(
							afterHookPackage("v1", { frequency: "batch" }, testPluginPackageId()),
						);
						const resolver = yield* AutomationPlannerResolver.make;
						const catalog = yield* DefinitionCatalog;
						const spans: Tracer.Span[] = [];
						yield* nested(
							Effect.gen(function* () {
								const transaction = new WriteTransaction();
								const candidates = {
									transaction,
									userId: owner,
									source: "api",
									resource: "entity",
								} as const;
								yield* resolver.lockCatalog([owner], transaction);
								yield* resolver.resolveBatchCandidates(candidates);
								yield* catalog.userPlugins(owner, transaction);
								yield* resolver.resolveBatchCandidates({
									...candidates,
									transaction: new WriteTransaction(),
								});
							}),
						).pipe(Effect.withTracer(makeRecordingTracer(spans)));
						expect(
							recordedStatements(spans).filter((text) =>
								text.includes("from plugin_installation i"),
							),
						).toHaveLength(2);
					}),
				testTimeout,
			);
			test.effect(
				"takes again in its transaction the locks a rolled-back savepoint took",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						yield* installRevisionPackage(
							afterHookPackage("v1", { frequency: "batch" }, testPluginPackageId()),
						);
						const resolver = yield* AutomationPlannerResolver.make;
						const advisoryLocks = session
							.run((db) =>
								db.execute<{ held: number }>(
									sql`select count(*)::int as held from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`,
									"objects",
								),
							)
							.pipe(Effect.map(([row]) => row?.held));
						const inSavepoint = yield* Ref.make<number | undefined>(undefined);
						const held = yield* nested(
							Effect.gen(function* () {
								const transaction = new WriteTransaction();
								yield* session
									.savepoint(
										Effect.gen(function* () {
											yield* resolver.lockCatalog(
												[owner],
												new WriteTransaction(transaction.preparation),
											);
											yield* Ref.set(inSavepoint, yield* advisoryLocks);
											return yield* Effect.fail("rolled back" as const);
										}),
									)
									.pipe(
										Effect.catchIf(
											(error) => error === "rolled back",
											() => Effect.void,
										),
									);
								const afterRollback = yield* advisoryLocks;
								yield* resolver.lockCatalog([owner], transaction);
								return { afterRollback, relocked: yield* advisoryLocks };
							}),
						);
						const taken = yield* Ref.get(inSavepoint);
						expect(taken).toBeGreaterThan(0);
						expect(held).toEqual({ relocked: taken, afterRollback: 0 });
					}),
				testTimeout,
			);
		},
	);
	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"pins explicit kernel collection observers without admitting same-name plugin events",
				() =>
					Effect.gen(function* () {
						const source = hookPackage();
						const [entity] = source.manifest.entitySchemas;
						assert(entity);
						const target = {
							resource: "event",
							operation: "create",
							owner: { kind: "kernel" },
							entitySchemaSlug: "collection",
							eventSchemaSlug: "add-entity-to-collection",
						} as const;
						const { owner: _owner, ...localTarget } = target;
						const candidate = {
							...source,
							manifest: {
								...source.manifest,
								entitySchemas: [
									...source.manifest.entitySchemas,
									{
										...entity,
										slug: "collection",
										eventSchemas: [
											{
												slug: target.eventSchemaSlug,
												propertiesSchema: { fields: {} },
												name: { key: "test.local-collection-add" },
											},
										],
									},
								],
								hooks: [
									...source.manifest.hooks,
									{
										targets: [target],
										name: "Kernel observer",
										stage: "after" as const,
										frequency: "batch" as const,
										executionScope: "user" as const,
										scriptSlug: "fixture.automation",
										slug: "fixture.collection-observer",
									},
									{
										name: "Local policy",
										targets: [localTarget],
										stage: "before" as const,
										scriptSlug: "fixture.policy",
										slug: "fixture.collection-policy",
									},
								],
							},
						};
						const installed = yield* installRevisionPackage({
							...candidate,
							manifest: yield* Schema.decodeEffect(PluginManifest)(candidate.manifest),
						});
						const planner = yield* LifecyclePlanner;
						const makePayload = Effect.fnUntraced(function* (pluginId: null | string) {
							const change = yield* eventChange(
								pluginId,
								"collection-item",
								target.eventSchemaSlug,
							);
							assert(change.operation === "create");
							return { ...change, after: { ...change.after, entitySchemaSlug: "collection" } };
						});
						const kernelPayload = yield* makePayload(null);
						const batch = yield* Schema.decodeEffect(AutomationTrigger)({
							...triggerFixture("kernel-batch"),
							scopeUserId: owner,
							kind: { resource: "event", category: "change", operation: "batch" },
							payload: {
								resource: "event",
								category: "change",
								operation: "batch",
								items: [kernelPayload],
							},
						});
						const planned = yield* planner.plan({
							trigger: batch,
							transaction: new WriteTransaction(),
						});
						expect(planned.runs).toMatchObject([
							{
								pluginId: installed.pluginId,
								pluginRevisionId: installed.revisionId,
								hookSlug: "fixture.collection-observer",
							},
						]);
						const pluginBatch = yield* Schema.decodeEffect(AutomationTrigger)({
							...batch,
							id: "plugin-batch",
							payload: {
								resource: "event",
								category: "change",
								operation: "batch",
								items: [yield* makePayload(installed.pluginId)],
							},
						});
						expect(
							(yield* planner.plan({ trigger: pluginBatch, transaction: new WriteTransaction() }))
								.runs,
						).toEqual([]);
						const revised = {
							...hookPackage("v2", candidate.manifest.metadata.packageId),
							manifest: {
								...candidate.manifest,
								metadata: { ...candidate.manifest.metadata, version: "v2" },
								hooks: candidate.manifest.hooks.filter(
									(hook) => hook.slug !== "fixture.collection-observer",
								),
							},
						};
						yield* installRevisionPackage(revised);
						expect(
							yield* planner.plan({ trigger: batch, transaction: new WriteTransaction() }),
						).toEqual({ ...planned, wasCreated: false });
						expect(
							(yield* nested(
								planner.plan({
									transaction: new WriteTransaction(),
									trigger: { ...batch, id: AutomationTriggerId.make("fresh-kernel-batch") },
								}),
							)).runs,
						).toEqual([]);
					}),
				testTimeout,
			);
		},
	);
	layer(
		LifecyclePlannerLive.pipe(
			Layer.provide(noLifecycleWorkLayer),
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(AutomationPlannerResolver, {
						lockCatalog: () => Effect.void,
						resolve: () => Effect.succeed([]),
						resolvePolicies: () => Effect.succeed([]),
						resolveBatchCandidates: () => Effect.succeed([]),
					}),
					AutomationRunRepository.layer,
					AutomationTriggerRepository.layer,
				),
			),
			Layer.provide(makeAppConfigLayer()),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)("planner harness", (test) => {
		test.effect(
			"uses the resolver supplied at planner construction",
			() =>
				Effect.gen(function* () {
					const installed = yield* installRevisionPackage(hookPackage());
					const planned = yield* (yield* LifecyclePlanner).plan({
						transaction: new WriteTransaction(),
						trigger: yield* entityTrigger(installed.pluginId, "injected-resolver"),
					});
					expect(planned.runs).toEqual([]);
					expect(planned).toEqual({ runs: [], trigger: null, _tag: "NoHooks", wasCreated: false });
					const session = yield* DatabaseSession;
					expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
						[],
					);
					expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
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
						const installed = yield* installRevisionPackage({
							...value,
							manifest: {
								...value.manifest,
								hooks: [
									...value.manifest.hooks,
									{
										name: "Facts",
										stage: "after",
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
									eventSchemaPluginId: installed.pluginId,
									entitySchemaPluginId: installed.pluginId,
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
									relationshipSchemaPluginId: installed.pluginId,
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
								entitySchemaPluginId: installed.pluginId,
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
							const planned = yield* planner.plan({ trigger, transaction: new WriteTransaction() });
							expect(planned.runs).toHaveLength(1);
							expect(planned.trigger).toEqual(trigger);
							expect(planned.runs[0]).toMatchObject({
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
								expect(
									yield* planner.plan({ trigger: mismatch, transaction: new WriteTransaction() }),
								).toEqual({ runs: [], trigger: null, _tag: "NoHooks", wasCreated: false });
							}
						}
					}),
				testTimeout,
			);
		},
	);

	layer(
		Layer.merge(plannerLayer(1), largerBudgetPlannerLayer).pipe(
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)("planner harness", (test) => {
		test.effect(
			"stores at most 100 distinct omitted hooks and accepts no partial runs",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const session = yield* DatabaseSession;
					const value = hookPackage();
					const hook = value.manifest.hooks.find(({ slug }) => slug === "fixture.changed");
					assert(hook?.stage === "after");
					const installed = yield* installRevisionPackage({
						...value,
						manifest: {
							...value.manifest,
							hooks: [
								...value.manifest.hooks,
								...Array.from({ length: 101 }, (_, index) => ({
									...hook,
									slug: `fixture.extra-${index}`,
								})),
							],
						},
					});
					const bounded = yield* entityTrigger(installed.pluginId, "bounded");
					const boundedDescendant = { ...bounded, causation: { ...bounded.causation, depth: 1 } };
					const blocked = yield* planner.plan({
						trigger: boundedDescendant,
						transaction: new WriteTransaction(),
					});
					assert(blocked.trigger);
					expect(blocked).toMatchObject({
						runs: [],
						trigger: { blockedReason: { code: "automation-limit-reached" } },
					});
					const [trigger] = yield* session.run((db) =>
						db
							.select()
							.from(tables.automationTrigger)
							.where(eq(tables.automationTrigger.id, "bounded")),
					);
					expect(trigger?.blockedReason?.omittedHooks).toHaveLength(100);
					expect(blocked.trigger.blockedReason).toEqual<unknown>(trigger?.blockedReason);
					yield* installRevisionPackage(hookPackage("v2"));
					expect(
						yield* planner.plan({
							trigger: boundedDescendant,
							transaction: new WriteTransaction(),
						}),
					).toEqual({ ...blocked, wasCreated: false });
					const replayWithLargerBudget = yield* (yield* LargerBudgetPlanner).plan({
						trigger: boundedDescendant,
						transaction: new WriteTransaction(),
					});
					expect(replayWithLargerBudget).toEqual({ ...blocked, wasCreated: false });
					expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"matches snapshots, snapshots retry and preserves pins on replay after upgrade",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const installed = yield* installRevisionPackage(hookPackage());
						for (const operation of ["create", "update", "delete"] as const) {
							const planned = yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: yield* entityTrigger(installed.pluginId, operation, operation),
							});
							expect(planned.runs).toHaveLength(1);
							expect(planned.runs[0]).toMatchObject({
								executionUserId: owner,
								pluginId: installed.pluginId,
								pluginRevisionId: installed.revisionId,
								retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
								artifactsExpireAt: "2026-09-22T00:00:00.000Z",
							});
							assert(planned.runs[0]);
							expect(planned.runs[0].id).toBe(lifecycleRunId(planned.runs[0]));
						}
						const original = yield* planner.plan({
							transaction: new WriteTransaction(),
							trigger: yield* entityTrigger(installed.pluginId, "create"),
						});
						yield* installRevisionPackage(hookPackage("v2"));
						expect(
							yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: yield* entityTrigger(installed.pluginId, "create"),
							}),
						).toEqual({ ...original, wasCreated: false });
						const next = yield* nested(
							planner.plan({
								transaction: new WriteTransaction(),
								trigger: yield* entityTrigger(installed.pluginId, "new"),
							}),
						);
						expect(next.runs[0]?.pluginRevisionId).not.toBe(original.runs[0]?.pluginRevisionId);
						expect(next.runs[0]?.sandboxScriptId).not.toBe(original.runs[0]?.sandboxScriptId);
						expect(next.runs[0]?.pluginConfigRevisionId).not.toBe(
							original.runs[0]?.pluginConfigRevisionId,
						);
						const filtered = yield* entityTrigger(installed.pluginId, "filtered");
						expect(
							yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: { ...filtered, causation: { ...filtered.causation, source: "bootstrap" } },
							}),
						).toEqual({ runs: [], trigger: null, _tag: "NoHooks", wasCreated: false });
						expect(
							yield* session.run((db) =>
								db
									.select()
									.from(tables.automationTrigger)
									.where(eq(tables.automationTrigger.id, "filtered")),
							),
						).toHaveLength(0);
					}),
				testTimeout,
			);
		},
	);

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"filters hidden, unready, tombstoned, wrong-scope and mismatched configuration without activating config",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const installed = yield* installRevisionPackage(hookPackage(), owner);
						const ready = yield* planner.plan({
							transaction: new WriteTransaction(),
							trigger: yield* entityTrigger(installed.pluginId, "ready"),
						});
						expect(ready.runs).toHaveLength(1);
						const activeConfigRevisionId = ready.runs[0]?.pluginConfigRevisionId;
						assert(activeConfigRevisionId);
						expect(
							yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: {
									...(yield* entityTrigger(installed.pluginId, "other")),
									scopeUserId: recipient,
								},
							}),
						).toMatchObject({ runs: [] });
						expect(
							yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: {
									...(yield* entityTrigger(installed.pluginId, "global")),
									scopeUserId: null,
								},
							}),
						).toMatchObject({ runs: [] });
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
							expect(
								yield* nested(
									planner.plan({
										transaction: new WriteTransaction(),
										trigger: yield* entityTrigger(installed.pluginId, id),
									}),
								),
							).toMatchObject({ runs: [] });
						}
						const configs = yield* session.run((db) =>
							db.select().from(tables.pluginConfigRevision),
						);
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
						expect(
							yield* nested(
								planner.plan({
									transaction: new WriteTransaction(),
									trigger: yield* entityTrigger(installed.pluginId, "mismatch"),
								}),
							),
						).toMatchObject({ runs: [] });
						expect(
							yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: yield* entityTrigger(installed.pluginId, "ready"),
							}),
						).toEqual({ ...ready, wasCreated: false });
					}),
				testTimeout,
			);
		},
	);

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
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
							transaction: new WriteTransaction(),
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
						expect(
							yield* planner.plan({
								trigger,
								recipients: [owner, recipient],
								transaction: new WriteTransaction(),
							}),
						).toEqual({ ...planned, wasCreated: false });
						expect(
							yield* planner.plan({
								recipients: [recipient],
								transaction: new WriteTransaction(),
								trigger: triggerFixture("inactive", PluginId.make(installed.pluginId)),
							}),
						).toMatchObject({ runs: [] });
						expect(
							yield* planner.plan({ trigger, recipients: [], transaction: new WriteTransaction() }),
						).toEqual({ ...planned, wasCreated: false });
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
				testTimeout,
			);
		},
	);

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
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
								...emptySandboxExecutionMetadata,
								kind: "automation" as const,
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
							transaction: new WriteTransaction(),
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
				testTimeout,
			);
		},
	);

	layer(
		Layer.merge(plannerLayer(2), AutomationTriggerRepository.layer).pipe(
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)("planner harness", (test) => {
		test.effect(
			"blocks whole fan-outs and depth, preserves blocked replay, and rolls source writes back on planning failure",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const triggers = yield* AutomationTriggerRepository;
					const session = yield* DatabaseSession;
					const installed = yield* installRevisionPackage(hookPackage());
					const firstTrigger = asDescendant(yield* entityTrigger(installed.pluginId, "first"));
					const first = yield* planner.plan({
						trigger: firstTrigger,
						transaction: new WriteTransaction(),
					});
					expect(first.runs).toHaveLength(1);
					expect(
						yield* planner.plan({ trigger: firstTrigger, transaction: new WriteTransaction() }),
					).toEqual({ ...first, wasCreated: false });
					const deep = yield* entityTrigger(installed.pluginId, "deep");
					const deepPlan = yield* planner.plan({
						transaction: new WriteTransaction(),
						trigger: { ...deep, causation: { ...deep.causation, depth: 3 } },
					});
					expect(deepPlan).toMatchObject({
						runs: [],
						trigger: { blockedReason: { code: "automation-limit-reached" } },
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
								yield* planner.plan({
									transaction: new WriteTransaction(),
									trigger: yield* entityTrigger(installed.pluginId, "rollback"),
								});
								return yield* new DbError({ message: "rollback" });
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
			testTimeout,
		);
	});
	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"plans an after hook only for the execution scope it declares",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const installed = yield* installRevisionPackage(
							afterHookPackage("v1", { executionScope: "user" }),
						);
						const globalTrigger = (id: string) =>
							Effect.map(entityTrigger(installed.pluginId, id), (trigger) => ({
								...trigger,
								scopeUserId: null,
							}));
						expect(
							(yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: yield* entityTrigger(installed.pluginId, "user-a"),
							})).runs,
						).toHaveLength(1);
						expect(
							(yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: yield* globalTrigger("global-a"),
							})).runs,
						).toEqual([]);
						yield* installRevisionPackage(afterHookPackage("v2", { executionScope: "global" }));
						expect(
							(yield* nested(
								planner.plan({
									transaction: new WriteTransaction(),
									trigger: yield* entityTrigger(installed.pluginId, "user-b"),
								}),
							)).runs,
						).toEqual([]);
						expect(
							(yield* nested(
								planner.plan({
									transaction: new WriteTransaction(),
									trigger: yield* globalTrigger("global-b"),
								}),
							)).runs,
						).toHaveLength(1);
					}),
				testTimeout,
			);
		},
	);

	layer(plannerLayer().pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"matches item hooks to item triggers and batch hooks to batch triggers",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const installed = yield* installRevisionPackage(hookPackage());
						const items = [
							entityChange(installed.pluginId, "entity-1"),
							entityChange(installed.pluginId, "entity-2"),
						];
						expect(
							(yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: yield* entityTrigger(installed.pluginId, "item"),
							})).runs,
						).toHaveLength(1);
						expect(
							(yield* planner.plan({
								transaction: new WriteTransaction(),
								trigger: yield* entityBatchTrigger("batch", items),
							})).runs,
						).toEqual([]);
						yield* installRevisionPackage(afterHookPackage("v2", { frequency: "batch" }));
						expect(
							(yield* nested(
								planner.plan({
									transaction: new WriteTransaction(),
									trigger: yield* entityTrigger(installed.pluginId, "item-2"),
								}),
							)).runs,
						).toEqual([]);
						expect(
							(yield* nested(
								planner.plan({
									transaction: new WriteTransaction(),
									trigger: yield* entityBatchTrigger("batch-2", items),
								}),
							)).runs,
						).toHaveLength(1);
						expect(
							(yield* nested(
								planner.plan({
									transaction: new WriteTransaction(),
									trigger: yield* entityBatchTrigger("batch-partial", [
										entityChange(installed.pluginId, "other", "absent-entity"),
										entityChange(installed.pluginId, "entity-3"),
									]),
								}),
							)).runs,
						).toHaveLength(1);
						expect(
							(yield* nested(
								planner.plan({
									transaction: new WriteTransaction(),
									trigger: yield* entityBatchTrigger("batch-none", [
										entityChange(installed.pluginId, "other", "absent-entity"),
									]),
								}),
							)).runs,
						).toEqual([]);
					}),
				testTimeout,
			);
		},
	);

	layer(plannerLayer(100, 2).pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"chunks batch evidence for batch-only hooks",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const installed = yield* installRevisionPackage(
							afterHookPackage("v1", { frequency: "batch" }),
						);
						const input = {
							resource: "entity" as const,
							identity: ["children", "entity"],
							command: {
								accountUserId: owner,
								itemIdentity: "population",
								occurredAt: "2026-09-15T00:00:00.000Z",
								causation: triggerFixture("unused").causation,
							},
						};
						const chunked = yield* nested(
							Effect.gen(function* () {
								const transaction = new WriteTransaction();
								const decision = yield* planner.prepareBatch(transaction, {
									...input,
									scopes: [owner],
								});
								expect(decision.hasCandidates).toBe(true);
								for (const [index, id] of ["first", "second", "third"].entries()) {
									yield* planner.recordBatchChange(transaction, decision.id, {
										index,
										scopeUserId: owner,
										payload: yield* Schema.decodeEffect(AutomationEntityChangePayload)(
											entityChange(installed.pluginId, id),
										),
									});
								}
								return yield* planner.planBatch(transaction, input);
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
					}),
				testTimeout,
			);
		},
	);
	layer(plannerLayer(100, 200).pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"applies a hook item cap to 200 matching items without loss or duplication",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const ids = Array.from(
							{ length: 200 },
							(_, index) => `item-${String(index).padStart(3, "0")}`,
						);
						const input: LifecycleBatchInput = {
							resource: "entity",
							identity: ["item-records", "entity"],
							command: {
								accountUserId: owner,
								itemIdentity: "item-records",
								occurredAt: "2026-09-15T00:00:00.000Z",
								causation: triggerFixture("item-records").causation,
							},
						};
						const installed = yield* installRevisionPackage(
							afterHookPackage("v1", { batchMaxItems: 50, frequency: "batch" }),
							owner,
						);
						const dispatch = yield* nested(
							Effect.gen(function* () {
								const transaction = new WriteTransaction();
								const decision = yield* planner.prepareBatch(transaction, {
									...input,
									scopes: [owner],
								});
								expect(decision.hasCandidates).toBe(true);
								for (const [batchIndex, id] of ids.entries()) {
									yield* planner.recordBatchChange(transaction, decision.id, {
										index: batchIndex,
										scopeUserId: owner,
										payload: yield* Schema.decodeEffect(AutomationEntityChangePayload)(
											entityChange(installed.pluginId, id),
										),
									});
								}
								return yield* planner.planBatch(transaction, input);
							}),
						);
						const triggers = yield* session.run((db) =>
							db
								.select({ payload: tables.automationTrigger.payload })
								.from(tables.automationTrigger),
						);
						const batches = triggers.flatMap(({ payload }) =>
							payload?.category === "change" &&
							payload.operation === "batch" &&
							payload.resource === "entity"
								? [payload]
								: [],
						);
						expect(
							batches.map(({ items }) => items.length).sort((left, right) => left - right),
						).toEqual([50, 50, 50, 50]);
						const committedIds = batches.flatMap(({ items }) =>
							items.map((item) => (item.operation === "delete" ? item.before.id : item.after.id)),
						);
						expect(committedIds).toHaveLength(200);
						expect(new Set(committedIds).size).toBe(200);
						expect([...committedIds].sort()).toEqual<unknown>(ids);
						expect(dispatch).toHaveLength(4);
						expect(dispatch.flatMap(({ runs }) => runs)).toHaveLength(4);
					}),
				testTimeout,
			);
		},
	);
	layer(plannerLayer(100, 200).pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"uses the lowest limit from matching batch hooks",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const value = afterHookPackage("v1", { batchMaxItems: 10, frequency: "batch" });
						const capHook = value.manifest.hooks.find(({ slug }) => slug === "fixture.changed");
						assert(capHook?.stage === "after");
						const installed = yield* installRevisionPackage(
							{
								...value,
								manifest: {
									...value.manifest,
									hooks: [
										...value.manifest.hooks,
										{
											...capHook,
											batchMaxItems: 4,
											name: "Small batch",
											slug: "fixture.small-batch",
										},
									],
								},
							},
							owner,
						);
						const input: LifecycleBatchInput = {
							resource: "entity",
							identity: ["mixed-limits", "entity"],
							command: {
								accountUserId: owner,
								itemIdentity: "mixed-limits",
								occurredAt: "2026-09-15T00:00:00.000Z",
								causation: triggerFixture("mixed-limits").causation,
							},
						};
						const ids = Array.from({ length: 11 }, (_, index) => `mixed-${index}`);
						const dispatch = yield* nested(
							Effect.gen(function* () {
								const transaction = new WriteTransaction();
								const decision = yield* planner.prepareBatch(transaction, {
									...input,
									scopes: [owner],
								});
								for (const [batchIndex, id] of ids.entries()) {
									yield* planner.recordBatchChange(transaction, decision.id, {
										index: batchIndex,
										scopeUserId: owner,
										payload: yield* Schema.decodeEffect(AutomationEntityChangePayload)(
											entityChange(installed.pluginId, id),
										),
									});
								}
								return yield* planner.planBatch(transaction, input);
							}),
						);
						const triggers = yield* session.run((db) =>
							db
								.select({ payload: tables.automationTrigger.payload })
								.from(tables.automationTrigger),
						);
						expect(
							triggers
								.flatMap(({ payload }) =>
									payload?.operation === "batch" ? [payload.items.length] : [],
								)
								.sort((left, right) => left - right),
						).toEqual([3, 4, 4]);
						expect(dispatch.flatMap(({ runs }) => runs)).toHaveLength(6);
					}),
				testTimeout,
			);
		},
	);
	layer(plannerLayer(100, 200).pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"planner harness",
		(test) => {
			test.effect(
				"ignores a pinned cap when its target does not match committed event items",
				() =>
					Effect.gen(function* () {
						const planner = yield* LifecyclePlanner;
						const session = yield* DatabaseSession;
						const value = hookPackage("v1");
						const [entitySchema] = value.manifest.entitySchemas;
						assert(entitySchema);
						const installed = yield* installRevisionPackage(
							{
								...value,
								manifest: {
									...value.manifest,
									entitySchemas: [
										{
											...entitySchema,
											eventSchemas: [
												...entitySchema.eventSchemas,
												{
													slug: "record-set",
													name: { key: "test.record-set" },
													propertiesSchema: { fields: {} },
												},
											],
										},
									],
									hooks: [
										...value.manifest.hooks,
										{
											stage: "after",
											frequency: "batch",
											name: "Fixture batch",
											slug: "fixture.fixture-batch",
											scriptSlug: "fixture.automation",
											targets: [eventTarget("changed")],
										},
										{
											stage: "after",
											batchMaxItems: 50,
											frequency: "batch",
											name: "Record logs",
											slug: "fixture.record-logs",
											scriptSlug: "fixture.automation",
											targets: [eventTarget("record-set")],
										},
									],
								},
							},
							owner,
						);
						const input: LifecycleBatchInput = {
							resource: "event",
							identity: ["fixture-only", "events"],
							command: {
								accountUserId: owner,
								itemIdentity: "fixture-only",
								occurredAt: "2026-09-15T00:00:00.000Z",
								causation: triggerFixture("fixture-only").causation,
							},
						};
						const ids = Array.from({ length: 60 }, (_, index) => `fixture-${index}`);
						const dispatch = yield* nested(
							Effect.gen(function* () {
								const transaction = new WriteTransaction();
								const decision = yield* planner.prepareBatch(transaction, {
									...input,
									scopes: [owner],
								});
								for (const [batchIndex, id] of ids.entries()) {
									yield* planner.recordBatchChange(transaction, decision.id, {
										index: batchIndex,
										scopeUserId: owner,
										payload: yield* Schema.decodeEffect(AutomationEventChangePayload)(
											yield* eventChange(installed.pluginId, id),
										),
									});
								}
								return yield* planner.planBatch(transaction, input);
							}),
						);
						const triggers = yield* session.run((db) =>
							db
								.select({ payload: tables.automationTrigger.payload })
								.from(tables.automationTrigger),
						);
						const batches = triggers.flatMap(({ payload }) =>
							payload?.operation === "batch" && payload.resource === "event" ? [payload] : [],
						);
						expect(batches).toHaveLength(1);
						expect(batches[0]?.items).toHaveLength(60);
						expect(
							dispatch.flatMap(({ runs }) => runs).map(({ hookSlug }) => hookSlug),
						).toEqual<unknown>(["fixture.fixture-batch"]);
					}),
				testTimeout,
			);
		},
	);
});

const preparationPackage = (version: string) => {
	const value = hookPackage(version);
	const name = `Automation ${version}`;
	return {
		...value,
		scripts: value.scripts.map((script) =>
			script.slug === "fixture.automation"
				? Object.assign(script, { name, metadata: Object.assign(script.metadata, { name }) })
				: script,
		),
		manifest: {
			...value.manifest,
			scripts: value.manifest.scripts.map((script) =>
				script.slug === "fixture.automation" ? Object.assign(script, { name }) : script,
			),
			hooks: value.manifest.hooks.map((hook) =>
				hook.slug === "fixture.changed" ? Object.assign(hook, { metadata: { version } }) : hook,
			),
		},
	};
};

class RecordedScriptChanges extends Context.Service<
	RecordedScriptChanges,
	{ readonly commits: Effect.Effect<ReadonlyArray<ScriptChangesInput>> }
>()("@ryot-app/kernel-backend/modules/automations/planner.test/RecordedScriptChanges") {}

const recordedScriptChanges = Layer.effectContext(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const commits = yield* Ref.make<ReadonlyArray<ScriptChangesInput>>([]);
		const commit = Effect.fnUntraced(function* <A>(
			input: ScriptChangesInput & { readonly receipt: CommitReceipt<CommittedChanges, A> },
		) {
			return yield* session
				.transaction(
					Effect.gen(function* () {
						const stored = yield* input.receipt.load;
						if (stored !== null) {
							return stored;
						}
						yield* Ref.update(commits, (all) => [...all, input]);
						return yield* input.receipt.record({ events: [] });
					}),
				)
				.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
		});
		return Context.make(
			ScriptChanges,
			ScriptChanges.of({
				commit,
				commitKeyed: () => Effect.die("After hooks commit against their attempt"),
			}),
		).pipe(Context.add(RecordedScriptChanges, { commits: Ref.get(commits) }));
	}),
);

describe("automation preparation", () => {
	layer(
		Layer.mergeAll(
			plannerLayer(),
			AutomationRunOperationsServiceLive.pipe(
				Layer.provideMerge(recordedScriptChanges),
				Layer.provide(
					Layer.mergeAll(Layer.mock(ScriptExecutionService)({}), unavailableScriptCallsLayer),
				),
			),
		).pipe(Layer.provideMerge(revisionDatabaseLayer)),
	)("planner harness", (test) => {
		test.effect(
			"commits an after hook's changes with its attempt's success exactly once",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const operations = yield* AutomationRunOperations;
					const installed = yield* installRevisionPackage(preparationPackage("v1"));
					const planned = yield* planner.plan({
						transaction: new WriteTransaction(),
						trigger: yield* entityTrigger(installed.pluginId, "committed-changes"),
					});
					const run = planned.runs.find(({ hookSlug }) => hookSlug === "fixture.changed");
					assert(run);
					const payload = { runId: run.id, attemptNumber: 1 };
					const { attempt } = yield* operations.claim(payload);
					expect(attempt?.status).toBe("running");
					const prepared = yield* operations.prepare(payload);
					expect(prepared.principal.subject).toMatchObject({
						runId: run.id,
						stage: "after",
						type: "automation-run",
					});
					const changes = {
						signals: [{ properties: {}, discriminator: "done", schemaSlug: "fixture.signal" }],
					};
					const outcome = {
						...payload,
						logs: [],
						error: null,
						timing: null,
						failureKind: null,
						returnedValue: { changes },
						status: "succeeded" as const,
					};
					const first = yield* operations.finalize(outcome, { changes, prepared });
					const replayed = yield* operations.finalize(outcome, { changes, prepared });
					expect(first.status).toBe("succeeded");
					expect(replayed).toEqual(first);
					const commits = yield* (yield* RecordedScriptChanges).commits;
					expect(commits).toHaveLength(1);
					expect(commits[0]).toMatchObject({
						changes,
						principal: prepared.principal,
						executionId: automationAttemptIdentity(run.id, 1).executionId,
					});
				}),
			testTimeout,
		);
		test.effect(
			"prepares from the pinned hooks and scripts after a plugin update",
			() =>
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					const operations = yield* AutomationRunOperations;
					const installed = yield* installRevisionPackage(preparationPackage("v1"));
					const planned = yield* planner.plan({
						transaction: new WriteTransaction(),
						trigger: yield* entityTrigger(installed.pluginId, "pinned-preparation"),
					});
					const run = planned.runs.find(({ hookSlug }) => hookSlug === "fixture.changed");
					assert(run);
					yield* installRevisionPackage(preparationPackage("v2"));
					const prepared = yield* operations.prepare({ runId: run.id, attemptNumber: 1 });
					assert("automation" in prepared.input);
					expect(prepared.input.automation.hookMetadata).toEqual({ version: "v1" });
					expect(prepared.subject).toMatchObject({ pluginRevisionId: installed.revisionId });
				}),
			testTimeout,
		);
	});
});

describe("after hook dispatch", () => {
	layer(
		Layer.mergeAll(
			plannerLayer(),
			LifecycleExecutionLive.pipe(
				Layer.provide(AutomationExecutionOperationsLive),
				Layer.provide(AutomationRunRepository.layer),
				Layer.provideMerge(recordingRunJobQueueLayer),
			),
		).pipe(Layer.provideMerge(revisionDatabaseLayer)),
	)("planner harness", (test) => {
		test.effect(
			"queues each after hook of a committed write as an automation run job",
			() =>
				Effect.gen(function* () {
					const installed = yield* installRevisionPackage(hookPackage());
					const planned = yield* nested(
						(yield* LifecyclePlanner).plan({
							transaction: new WriteTransaction(),
							trigger: yield* entityTrigger(installed.pluginId, "committed-write"),
						}),
					);
					const [run] = planned.runs;
					assert(planned.trigger && run && planned.runs.length === 1);
					expect(yield* yield* RunJobSubmissions).toEqual([]);
					yield* (yield* LifecycleExecution).dispatch([
						toLifecycleDispatchPlan({ ...planned, trigger: planned.trigger }),
					]);
					expect(yield* yield* RunJobSubmissions).toEqual<unknown>([
						{
							kind: "automation-run",
							payload: { runId: run.id, attemptNumber: 1 },
							key: automationAttemptIdentity(run.id, 1).executionId,
						},
					]);
				}),
			testTimeout,
		);
	});
});

class RecordedPolicyCalls extends Context.Service<
	RecordedPolicyCalls,
	{ readonly calls: Effect.Effect<ReadonlyArray<AutomationPolicyBatchInput>> }
>()("@ryot-app/kernel-backend/modules/automations/planner.test/RecordedPolicyCalls") {}

const recordedPolicies = Layer.unwrap(
	Effect.gen(function* () {
		const calls = yield* Ref.make<ReadonlyArray<AutomationPolicyBatchInput>>([]);
		return LifecyclePoliciesServiceLive.pipe(
			Layer.provide(
				scriptCallsLayer((call) =>
					Effect.gen(function* () {
						const input = yield* Schema.decodeUnknownEffect(AutomationPolicyBatchInput)(
							call.input,
						).pipe(Effect.orDie);
						yield* Ref.update(calls, (all) => [...all, input]);
						return scriptCallResult({
							items: input.items.map(({ itemIdentity }) => ({
								itemIdentity,
								decision: { action: "allow" },
							})),
						});
					}),
				),
			),
			Layer.provideMerge(Layer.succeed(RecordedPolicyCalls, { calls: Ref.get(calls) })),
		);
	}),
);

describe("LifecyclePolicies PostgreSQL", () => {
	layer(recordedPolicies.pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"policies harness",
		(test) => {
			test.effect(
				"calls each matched policy once with all of its items in position order and writes no automation rows",
				() =>
					Effect.gen(function* () {
						const policies = yield* LifecyclePolicies;
						const session = yield* DatabaseSession;
						const installed = yield* installRevisionPackage(hookPackage());
						const request = yield* Schema.decodeEffect(AutomationRequestPayload)({
							resource: "entity",
							category: "request",
							operation: "create",
							draft: {
								name: "Entity",
								properties: {},
								externalId: null,
								providerId: null,
								populatedAt: null,
								entitySchemaSlug: "fixture-entity",
								entitySchemaPluginId: installed.pluginId,
							},
						});
						const policyRequest = policyRequestFixture(
							"entity",
							["first", "second", "third"].map((itemIdentity) => ({ request, itemIdentity })),
						);
						const matched = yield* policies.match(policyRequest, new WriteTransaction());
						expect(matched.map(({ hook }) => hook.slug)).toEqual([
							"fixture.z-first",
							"fixture.a-second",
						]);
						for (const policy of matched) {
							expect(
								(yield* policies.run({ policy, request: policyRequest })).items.map(
									({ itemIdentity }) => itemIdentity,
								),
							).toEqual(["first", "second", "third"]);
						}
						expect(
							(yield* (yield* RecordedPolicyCalls).calls).map(({ items, automation }) => ({
								hookSlug: automation.hookSlug,
								items: items.map(({ itemIdentity }) => itemIdentity),
							})),
						).toEqual<unknown>([
							{ hookSlug: "fixture.z-first", items: ["first", "second", "third"] },
							{ hookSlug: "fixture.a-second", items: ["first", "second", "third"] },
						]);
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
						expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual([]);
					}),
				testTimeout,
			);
		},
	);

	layer(recordedPolicies.pipe(Layer.provideMerge(revisionDatabaseLayer)))(
		"policies harness",
		(test) => {
			test.effect(
				"gives a once-per-subject policy one item per subject",
				() =>
					Effect.gen(function* () {
						const policies = yield* LifecyclePolicies;
						const installed = yield* installRevisionPackage(
							eventPolicyPackage("v1", 7, "once-per-subject"),
						);
						const request = yield* eventPolicyRequest(installed.pluginId);
						assert(request.resource === "event" && request.operation === "create");
						const other = yield* Schema.decodeEffect(AutomationRequestPayload)({
							...request,
							draft: { ...request.draft, entityId: "other" },
						});
						const policyRequest = policyRequestFixture("event", [
							{ request, itemIdentity: "first" },
							{ request, itemIdentity: "repeat" },
							{ request: other, itemIdentity: "other" },
						]);
						const [policy] = yield* policies.match(policyRequest, new WriteTransaction());
						assert(policy);
						const output = yield* policies.run({ policy, request: policyRequest });
						expect(output.items.map(({ itemIdentity }) => itemIdentity)).toEqual([
							"first",
							"other",
						]);
					}),
				testTimeout,
			);
		},
	);

	layer(
		LifecyclePoliciesLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.mock(AutomationPlannerResolver)({}),
					Layer.mock(EntitiesRepository)({}),
					Layer.mock(SandboxRepository)({
						pinnedPrincipal: () => Effect.fail(new DbError({ message: "Script pin read failed" })),
					}),
					scriptCallsLayer(() => Effect.die("A policy whose pin read failed must not run")),
				),
			),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)("failing policy reads", (test) => {
		test.effect(
			"surfaces a policy's database failure instead of policy-execution-failed",
			() =>
				Effect.gen(function* () {
					const exit = yield* Effect.exit(
						(yield* LifecyclePolicies).run({
							request: policyRequestFixture("entity", []),
							policy: policyFixture(0, [
								{ resource: "entity", operation: "create", entitySchemaSlug: "record" },
							]),
						}),
					);
					assertExitFails(exit, new DbError({ message: "Script pin read failed" }));
				}),
			testTimeout,
		);
	});
});
