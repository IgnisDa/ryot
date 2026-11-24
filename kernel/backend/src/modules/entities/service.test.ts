import { describe, expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import { DbError } from "@ryot-app/contract/errors";
import type { AutomationPolicyOutput } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
	type ListedEntity,
} from "@ryot-app/contract/modules/entities/schemas";
import {
	definitionOwner,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { type AppSchema, mapAppSchemaText } from "@ryot-app/contract/schema/property-schema";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { kernelDefinitionSource } from "@ryot-app/definitions/kernel-definitions";
import type { DefinitionSource } from "@ryot-app/definitions/snapshot";
import { revisionDefinitions } from "@ryot-app/definitions/source";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Redacted, Ref } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import {
	insertManagedAsset,
	managedAssetProperty,
} from "#lib/domain/managed-asset-writes.test-support";
import {
	noHooksFixture,
	policyFixture,
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import {
	AutomationPolicyExecutionError,
	LifecyclePolicies,
} from "#modules/automations/lifecycle/policies";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { entityChangeSets, entityUpdate } from "#modules/changes/change-sets.test-support";
import type { Changes } from "#modules/changes/changes";
import { savedEntity } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EventMutations } from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { PluginConfigEncryptionKey } from "#modules/plugins/configuration/encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/configuration/revisions";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { revisionPackage } from "#modules/plugins/packages/revision.test-support";
import { insertPluginRevision } from "#modules/plugins/test-support";
import { unavailableScriptCallsLayer } from "#modules/scripts/executions/calls.test-support";
import { retryOnDeadlock } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import { WritePreparation, WriteTransaction } from "#platform/db/write-transaction";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import * as tables from "#schema/tables/combined";
import { applyBaselineMigration, baselineMigrationStatements } from "#testing/baseline-migration";
import { testDatabaseUrl } from "#testing/database";
import { makeAppConfigLayer, makeConfigProviderLayer, makeWorkflowEngine } from "#testing/effect";

import { EntitiesRepository } from "./repository";
import { acceptPrepared, EntitiesService } from "./service";
import {
	countStatementClasses,
	recordingDatabaseLayer,
	StatementLog,
} from "./statement-recording.test-support";
import { emptyEntityUserDataAttachments } from "./user-data/attachments.test-support";
import { type DomainLifecycleCommand, DomainWriteChecksLive } from "./write-context";

const owner = UserId.make("owner");
const slug = EntitySchemaSlug.make("record");
const entitySchema: EntitySchemaReference = { slug, owner: { kind: "kernel" } };
const command = (id: string) => ({
	...rootLifecycleCommand({
		source: "api",
		lane: "interactive",
		accountUserId: owner,
		itemIdentity: "entity",
		initiator: { id: owner, kind: "user" },
		executionId: AutomationExecutionId.make(id),
		occurredAt: IsoUtcString.make("2026-09-15T00:00:00.000Z"),
	}),
	writeContext: null,
});
const systemCommand = (id: string) => ({
	...rootLifecycleCommand({
		source: "api",
		lane: "interactive",
		accountUserId: null,
		itemIdentity: "entity",
		initiator: { id: null, kind: "system" },
		executionId: AutomationExecutionId.make(id),
		occurredAt: IsoUtcString.make("2026-09-15T00:00:00.000Z"),
	}),
	writeContext: null,
});
type GlobalUpsert = NonNullable<Changes["globalEntities"]>[number];
type EntityCreate = NonNullable<NonNullable<Changes["entities"]>["creates"]>[number];
const originalCreate: EntityCreate = {
	entitySchema,
	name: " Original ",
	properties: { title: "original" },
};
const ownerCreate = (create: EntityCreate = originalCreate) => ({
	userId: owner,
	entities: { creates: [create] },
});
const createEvent = (id: EventId, userId: UserId, entityId: EntityId, sessionEntityId?: EntityId) =>
	Effect.gen(function* () {
		const repository = yield* EventsRepository;
		const session = yield* DatabaseSession;
		return yield* session.transaction(
			repository.createEvent(new WriteTransaction(), {
				id,
				userId,
				entityId,
				properties: {},
				eventSchemaPluginId: null,
				propertiesSchema: { fields: {} },
				eventSchemaSlug: EventSchemaSlug.make("progress"),
				eventSchemaName: { namespace: "kernel", key: "test.progress" },
				occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-15T00:00:00.000Z")),
				...(sessionEntityId === undefined ? {} : { sessionEntityId }),
			}),
		);
	});
type TestOptions = {
	noHooks?: boolean;
	deadlockOnce?: boolean;
	extraEntitySchemas?: number;
	lateEventOnDelete?: boolean;
	activateSchemaOnLock?: number;
	failChange?: number | boolean;
	recordStatements?: { holdLocks?: RegExp };
	policies?: ReadonlyArray<"fail" | AutomationPolicyOutput>;
	policyEntityProvenance?: { entityId: EntityId; providerId: SandboxProviderId };
};

class FakeEntityLifecycle extends Context.Service<
	FakeEntityLifecycle,
	{ readonly policyCalls: Effect.Effect<ReadonlyArray<string>> }
>()("@ryot-app/kernel-backend/modules/entities/service.test/FakeEntityLifecycle") {}

const entitiesLayer = (options: TestOptions = {}) =>
	Layer.provideMerge(
		Layer.unwrap(
			Effect.gen(function* () {
				const name = `entity_test_${(yield* randomUuid).replaceAll("-", "")}`;
				const databaseUrl = Redacted.make(yield* testDatabaseUrl);
				const changePlans = yield* Ref.make(0);
				const catalogLocks = yield* Ref.make(0);
				const policyCalls = yield* Ref.make<ReadonlyArray<string>>([]);
				const recordSchema: DefinitionSource["entitySchemas"][number] = {
					slug,
					pluginId: null,
					icon: "record",
					name: { key: "test.record" },
					eventSchemas: [
						{
							pluginId: null,
							slug: "progress",
							name: { key: "test.progress" },
							propertiesSchema: { fields: {} },
						},
					],
					propertiesSchema: {
						fields: {
							image: managedAssetProperty,
							title: { type: "string", label: "Title", description: "Title" },
							code: { label: "Code", type: "string", immutable: true, description: "Code" },
							score: {
								type: "number",
								label: "Score",
								description: "Score",
								normalize: { round: { scale: 2 } },
							},
						},
					},
				};
				const source: DefinitionSource = {
					savedViews: [],
					signalSchemas: [],
					calendarSources: [],
					relationshipSchemas: [],
					entitySchemas: [
						recordSchema,
						...kernelDefinitionSource().entitySchemas,
						...Array.from({ length: options.extraEntitySchemas ?? 0 }, (_, index) => ({
							...recordSchema,
							eventSchemas: [],
							slug: EntitySchemaSlug.make(`record-${index}`),
						})),
					],
				};
				const base = Layer.mergeAll(
					PluginRepository.layer,
					PluginInstallationRepository.layer,
					PluginConfigRevisions.layer,
					PluginConfigEncryptionKey.layer,
				);
				const schemaActivated = Effect.map(
					Ref.get(catalogLocks),
					(count) =>
						options.activateSchemaOnLock !== undefined && count >= options.activateSchemaOnLock,
				);
				const activated = <D extends { propertiesSchema: AppSchema }>(definition: D) =>
					Effect.map(schemaActivated, (active) =>
						active
							? {
									...definition,
									propertiesSchema: {
										...definition.propertiesSchema,
										fields: {
											...definition.propertiesSchema.fields,
											activated: {
												type: "boolean" as const,
												description: "Activated",
												label: { key: "test.activated" },
											},
											score: {
												description: "Score",
												type: "number" as const,
												label: { key: "test.score" },
												normalize: { round: { scale: 0 } },
											},
										},
									},
								}
							: definition,
					);
				const runtime =
					options.activateSchemaOnLock === undefined
						? Layer.merge(
								PluginRuntimeResolver.layer.pipe(Layer.provide(base)),
								DefinitionRepository.layer,
							)
						: Layer.merge(
								Layer.mock(PluginRuntimeResolver)({
									lockCatalog: () => Ref.update(catalogLocks, (count) => count + 1),
								}),
								Layer.effect(
									DefinitionRepository,
									Effect.map(
										DefinitionRepository.make.pipe(
											Effect.provideServiceEffect(DefinitionCatalog, DefinitionCatalog.make),
										),
										(definitions) => ({
											...definitions,
											findGlobalEntitySchema: (reference) =>
												definitions
													.findGlobalEntitySchema(reference)
													.pipe(
														Effect.flatMap((definition) =>
															definition ? activated(definition) : Effect.succeed(null),
														),
													),
											findUserEntitySchemas: (userId, references) =>
												definitions.findUserEntitySchemas(userId, references).pipe(
													Effect.flatMap((found) =>
														Effect.forEach(Object.entries(found), ([key, definition]) =>
															Effect.map(activated(definition), (value) => [key, value] as const),
														),
													),
													Effect.map(Object.fromEntries),
												),
										}),
									),
								),
							);
				const repositories = Layer.mergeAll(
					EntitiesRepository.layer.pipe(Layer.provide(Layer.merge(base, runtime))),
					DomainWriteChecksLive,
					EventsRepository.layer,
					EventSchemaReader.layer.pipe(Layer.provide(runtime)),
					AutomationTriggerRepository.layer,
				);
				const ports = Layer.effect(
					LifecyclePlanner,
					Effect.gen(function* () {
						const triggers = yield* AutomationTriggerRepository;
						const session = yield* DatabaseSession;
						return LifecyclePlanner.of(
							withLifecycleBatchPlanning(
								{
									plan: ({ trigger }) =>
										Effect.gen(function* () {
											expect(yield* session.isTransactionActive).toBe(true);
											if (options.noHooks) {
												return noHooksFixture();
											}
											const persisted = yield* triggers.insert({ ...trigger, blockedReason: null });
											const changePlanCount =
												trigger.kind.category === "change"
													? yield* Ref.updateAndGet(changePlans, (count) => count + 1)
													: yield* Ref.get(changePlans);
											if (
												trigger.kind.category === "change" &&
												options.deadlockOnce &&
												changePlanCount === 1
											) {
												return yield* new DbError({
													code: "40P01",
													message: "Injected deadlock after insert",
												});
											}
											if (
												trigger.kind.category === "change" &&
												(options.failChange === true || options.failChange === changePlanCount)
											) {
												return yield* new DbError({
													message: "Injected planning failure after insert",
												});
											}
											return { runs: [], wasCreated: true, trigger: persisted };
										}),
								},
								200,
								!options.noHooks,
							),
						);
					}),
				).pipe(Layer.provide(repositories));
				const execution = Layer.effect(
					LifecycleExecution,
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						return withLifecycleDispatch(
							{
								after: ({ triggerId }) =>
									Effect.gen(function* () {
										expect(yield* session.isTransactionActive).toBe(false);
										const [trigger] = yield* session.run((db) =>
											db
												.select()
												.from(tables.automationTrigger)
												.where(eq(tables.automationTrigger.id, triggerId)),
										);
										assert(trigger);
										expect(trigger.category).toBe("change");
									}).pipe(Effect.orDie),
							},
							session,
						);
					}),
				);
				const policies = Layer.effect(
					LifecyclePolicies,
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const eventRepository = yield* EventsRepository;
						return LifecyclePolicies.of({
							run: ({ items, policy }) =>
								Effect.gen(function* () {
									yield* Ref.update(policyCalls, (all) => [...all, policy.runId]);
									expect(yield* session.isTransactionActive).toBe(false);
									const index = policy.position;
									if (index === 1) {
										expect(items.map(({ request }) => request.draft)).toMatchObject([
											{ name: "First", properties: { title: "first" } },
										]);
									}
									const output = options.policies?.[index];
									assert(output);
									if (options.policyEntityProvenance) {
										const provenance = options.policyEntityProvenance;
										yield* session
											.run((db) =>
												db
													.update(tables.entity)
													.set({ externalId: "policy-source", providerId: provenance.providerId })
													.where(eq(tables.entity.id, provenance.entityId)),
											)
											.pipe(Effect.orDie);
									}
									if (output === "fail") {
										return yield* new AutomationPolicyExecutionError({
											runId: policy.runId,
											code: "policy-execution-failed",
										});
									}
									return {
										items: items.map(({ itemIdentity }) => ({ itemIdentity, decision: output })),
									};
								}),
							match: (trigger) =>
								Effect.gen(function* () {
									if (
										options.lateEventOnDelete &&
										trigger.scopeUserId !== null &&
										trigger.payload?.resource === "event" &&
										trigger.payload.category === "request" &&
										trigger.payload.operation === "batch" &&
										trigger.payload.items[0]?.resource === "event" &&
										trigger.payload.items[0].operation === "delete"
									) {
										const before = trigger.payload.items[0].draft;
										yield* eventRepository
											.createEvent(new WriteTransaction(), {
												entityId: before.entityId,
												eventSchemaPluginId: null,
												userId: trigger.scopeUserId,
												properties: before.properties,
												propertiesSchema: { fields: {} },
												id: EventId.make("late-cascade-event"),
												eventSchemaSlug: before.eventSchemaSlug,
												eventSchemaName: { namespace: "kernel", key: "test.progress" },
												occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(before.occurredAt)),
												...(before.sessionEntityId === null
													? {}
													: { sessionEntityId: before.sessionEntityId }),
											})
											.pipe(Effect.orDie);
										return [
											policyFixture(0, [
												{
													resource: "event",
													operation: "delete",
													entitySchemaSlug: slug,
													eventSchemaSlug: before.eventSchemaSlug,
												},
											]),
										];
									}
									return trigger.payload?.category === "request" &&
										trigger.payload.resource === "entity"
										? (options.policies ?? []).map((_, index) =>
												policyFixture(index, [
													{ resource: "entity", operation: "create", entitySchemaSlug: slug },
												]),
											)
										: [];
								}),
						});
					}),
				).pipe(Layer.provide(repositories));
				const eventMutations = EventMutations.layer.pipe(
					Layer.provide(
						Layer.mergeAll(
							WorkflowExecutionNotifications.layer,
							unavailableScriptCallsLayer,
							repositories,
							ports,
							execution,
							policies,
							Layer.succeed(
								WorkflowEngine,
								makeWorkflowEngine({
									activityExecute: (activity) =>
										Effect.map(
											Effect.exit(activity.execute),
											(exit) => new Workflow.Complete({ exit }),
										),
								}),
							),
						),
					),
				);
				const dependencies = Layer.mergeAll(
					repositories,
					ports,
					execution,
					policies,
					eventMutations,
					emptyEntityUserDataAttachments,
				);
				const services = Layer.mergeAll(
					repositories,
					Layer.effect(ChangeSets, entityChangeSets()).pipe(
						Layer.provideMerge(EntitiesService.layer.pipe(Layer.provide(dependencies))),
						Layer.provide(dependencies),
					),
				).pipe(
					Layer.provideMerge(
						recordingDatabaseLayer(options.recordStatements).pipe(
							Layer.provide(
								PgClient.layer({
									url: databaseUrl,
									maxConnections: options.recordStatements ? 4 : 1,
									startupParameters: { search_path: `${name}, public` },
								}),
							),
						),
					),
					Layer.provide(makeAppConfigLayer({ database: { url: databaseUrl } })),
				);
				const schema = Layer.effectDiscard(
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const statements = yield* baselineMigrationStatements();
						yield* Effect.acquireRelease(
							session.run((db) => db.execute(sql`create schema ${sql.identifier(name)}`)),
							() =>
								session
									.run((db) => db.execute(sql`drop schema ${sql.identifier(name)} cascade`))
									.pipe(Effect.orDie),
						);
						yield* session.run((db) =>
							Effect.gen(function* () {
								yield* db.execute(sql`set search_path to ${sql.identifier(name)}, public`);
								yield* applyBaselineMigration(statements, (statement) =>
									db.execute(sql.raw(statement)),
								);
							}),
						);
						yield* (yield* DefinitionRepository.make.pipe(
							Effect.provideServiceEffect(DefinitionCatalog, DefinitionCatalog.make),
						)).replaceKernelDefinitions(source);
						yield* session.run((db) =>
							db
								.insert(tables.user)
								.values({ id: owner, name: "Owner", email: "owner@example.test" }),
						);
					}),
				);
				return Layer.mergeAll(
					schema,
					Layer.succeed(FakeEntityLifecycle, { policyCalls: Ref.get(policyCalls) }),
				).pipe(Layer.provideMerge(services), Layer.provideMerge(makeConfigProviderLayer()));
			}),
		),
		BunCrypto.layerSecureRandom,
	);

const proposal = (name: string, properties: { title: string }) => ({
	action: "transform" as const,
	patch: {
		resource: "entity" as const,
		draft: { name, properties: { remove: [], set: properties } },
	},
});

const expectInvariant = (counts: ReadonlyArray<ReturnType<typeof countStatementClasses>>) => {
	const [small, large] = counts;
	assert(small && large);
	expect(large).toEqual(small);
	expect([small.check, small.lock].every((count) => count > 0)).toBe(true);
};

/** Deletes of `ids` under `schema` by a kernel writer in `userId`'s scope. */
const deletesOf = (
	userId: null | UserId,
	ids: ReadonlyArray<EntityId>,
	schema: EntitySchemaReference = entitySchema,
) => ({
	userId,
	entities: { deletes: ids.map((entityId) => ({ entityId, entitySchema: schema })) },
});

/** Commits provider upserts as global entities of `userId`'s scope, answering each entity in order. */
const commitUpserts = (
	items: ReadonlyArray<GlobalUpsert>,
	lifecycle: DomainLifecycleCommand,
	userId: null | UserId = null,
) =>
	Effect.flatMap(ChangeSets, (sets) =>
		sets.commit({ userId, globalEntities: items }, lifecycle),
	).pipe(Effect.map((result) => result.entities.map(({ entity }) => entity)));

describe("EntitiesService committed lifecycle", () => {
	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"rejects stale loaded snapshots but replays a committed conditional update",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const created = yield* changeSets
						.commit(ownerCreate(), command("conditional-create"))
						.pipe(Effect.flatMap(savedEntity));
					const update = (id: string) =>
						changeSets
							.commit(
								{
									userId: owner,
									entities: { updates: [entityUpdate(created, "Changed", { title: "changed" })] },
								},
								command(id),
							)
							.pipe(Effect.flatMap(savedEntity));
					const saved = yield* update("conditional-update");
					expect(saved.properties).toEqual({ title: "changed" });
					assertExitFails(
						yield* Effect.exit(update("stale-update")),
						new EntityStale({ reason: { code: "entity-stale", entityId: created.id } }),
					);
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"rejects user updates that change or omit an immutable property",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const created = yield* changeSets
						.commit(
							ownerCreate({ ...originalCreate, properties: { code: "a", title: "original" } }),
							command("immutable-create"),
						)
						.pipe(Effect.flatMap(savedEntity));
					const update = (id: string, properties: Record<string, unknown>) =>
						changeSets
							.commit(
								{
									userId: owner,
									entities: { updates: [entityUpdate(created, "Changed", properties)] },
								},
								command(id),
							)
							.pipe(Effect.flatMap(savedEntity));
					expect(yield* update("immutable-changed", { code: "b" }).pipe(Effect.flip)).toMatchObject(
						{ reason: { property: "code", code: "immutable-property" } },
					);
					expect(
						yield* update("immutable-omitted", { title: "x" }).pipe(Effect.flip),
					).toMatchObject({ reason: { property: "code", code: "immutable-property" } });
					const unchanged = yield* update("immutable-kept", { code: "a", title: "changed" });
					expect(unchanged.properties).toEqual({ code: "a", title: "changed" });
				}),
			testTimeout,
		);
		test.effect(
			"leaves global updates unaffected by immutable properties",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const global = yield* changeSets
						.commit(
							{
								userId: null,
								entities: { creates: [{ ...originalCreate, properties: { code: "a" } }] },
							},
							command("immutable-global"),
						)
						.pipe(Effect.flatMap(savedEntity));
					const updated = yield* changeSets
						.commit(
							{
								userId: null,
								entities: { updates: [entityUpdate(global, "Changed", { code: "b" })] },
							},
							command("immutable-global-update"),
						)
						.pipe(Effect.flatMap(savedEntity));
					expect(updated.properties).toEqual({ code: "b" });
				}),
			testTimeout,
		);
	});
	layer(
		entitiesLayer({
			policies: [
				{
					action: "transform",
					patch: { resource: "entity", draft: { properties: { set: {}, remove: ["code"] } } },
				},
			],
		}),
	)("entities service harness", (test) => {
		test.effect(
			"rejects a before-stage policy that removes a stored immutable property",
			() =>
				Effect.gen(function* () {
					const repository = yield* EntitiesRepository;
					const session = yield* DatabaseSession;
					const changeSets = yield* ChangeSets;
					const [stored] = yield* session.transaction(
						repository.insertEntities([
							{
								scope: "user",
								userId: owner,
								name: "Stored",
								populatedAt: null,
								entitySchemaSlug: slug,
								properties: { code: "a" },
								entitySchemaPluginId: null,
								id: EntityId.make("stored-immutable"),
								createdAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-15T00:00:00.000Z")),
							},
						]),
					);
					assert(stored);
					expect(
						yield* changeSets
							.commit(
								{
									userId: owner,
									entities: { updates: [entityUpdate(stored, "Changed", { code: "a" })] },
								},
								command("immutable-policy"),
							)
							.pipe(Effect.flip),
					).toMatchObject({ reason: { property: "code", code: "immutable-property" } });
					expect(
						(yield* repository.getByIdForUser({ userId: owner, entityId: stored.id }))?.properties,
					).toEqual({ code: "a" });
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer({ noHooks: true }))("entities service harness", (test) => {
		test.effect(
			"user-owned updates reject global records",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const global = yield* changeSets
						.commit(
							{ userId: null, entities: { creates: [originalCreate] } },
							command("global-record"),
						)
						.pipe(Effect.flatMap(savedEntity));
					expect(
						yield* changeSets
							.commit(
								{
									userId: owner,
									entities: { updates: [entityUpdate(global, "Changed", { title: "changed" })] },
								},
								command("forbidden-global-update"),
							)
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "entity-not-found" } });
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"normalizes numeric properties before persisting the entity and change snapshot",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const result = yield* (yield* ChangeSets)
						.commit(
							ownerCreate({ ...originalCreate, properties: { score: 25.555, title: "numeric" } }),
							command("normalized"),
						)
						.pipe(Effect.flatMap(savedEntity));
					expect(result.properties).toEqual({ score: 25.56, title: "numeric" });
					const changes = (yield* session.run((db) =>
						db.select().from(tables.automationTrigger),
					)).find((row) => row.category === "change");
					expect(changes?.payload).toMatchObject({
						after: { properties: { score: 25.56, title: "numeric" } },
					});
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"commits a create without policies and replays it onto the same row",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const create = (yield* ChangeSets)
						.commit(ownerCreate(), command("step-fast"))
						.pipe(Effect.flatMap(savedEntity));
					const fast = yield* create;
					expect(fast.name).toBe("Original");
					expect(
						(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
							({ category, operation }) => [category, operation],
						),
					).toEqual([
						["change", "create"],
						["change", "batch"],
					]);
					const replay = yield* create;
					expect(replay.id).toBe(fast.id);
					expect(
						(yield* session.run((db) => db.select().from(tables.entity))).map(({ id }) => id),
					).toEqual([fast.id]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer({ policies: [{ action: "allow" }] }))("entities service harness", (test) => {
		test.effect(
			"runs matched policies outside the commit and keeps the recorded rows",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const committed = yield* (yield* ChangeSets)
						.commit(ownerCreate(), command("step-policies"))
						.pipe(Effect.flatMap(savedEntity));
					expect(committed.name).toBe("Original");
					expect(
						(yield* session.run((db) => db.select().from(tables.entity))).map(({ name }) => name),
					).toEqual(["Original"]);
					expect(
						(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
							({ category }) => category,
						),
					).toEqual(["change", "change"]);
					expect(yield* (yield* FakeEntityLifecycle).policyCalls).toEqual(["policy-0"]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer({ activateSchemaOnLock: 1 }))("entities service harness", (test) => {
		test.effect(
			"revalidates the entity schema under the catalog lock before writing",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					expect(
						yield* (yield* ChangeSets)
							.commit(ownerCreate(), command("schema-race"))
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "mutation-conflict" } });
					expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"rejects invalid names, missing schemas and incomplete provenance before planning",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const session = yield* DatabaseSession;
					const create = (id: string, entity: EntityCreate) =>
						changeSets.commit(ownerCreate(entity), command(id)).pipe(Effect.flip);
					expect(yield* create("name", { ...originalCreate, name: "   " })).toMatchObject({
						reason: { code: "name-required" },
					});
					expect(
						yield* create("missing", {
							...originalCreate,
							entitySchema: { owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("missing") },
						}),
					).toMatchObject({ reason: { code: "entity-schema-not-found" } });
					expect(
						yield* create("provenance", { ...originalCreate, externalId: "incomplete" }),
					).toMatchObject({ reason: { code: "incomplete-provenance" } });
					expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
						[],
					);
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer({ failChange: 3 }))("entities service harness", (test) => {
		test.effect(
			"rolls a delete back with its change plan",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const session = yield* DatabaseSession;
					const created = yield* changeSets
						.commit(ownerCreate(), command("before-delete"))
						.pipe(Effect.flatMap(savedEntity));
					expect(
						yield* changeSets
							.commit(deletesOf(owner, [created.id]), command("delete-rollback"))
							.pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError" });
					expect(yield* (yield* EntitiesRepository).getById(created.id)).toEqual<unknown>(created);

					expect(
						(yield* session.run((db) => db.select().from(tables.automationTrigger)))
							.filter((row) => row.category === "change")
							.map((row) => row.operation),
					).toEqual(["create", "batch"]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"deletes record-session events with item and batch lifecycle plans",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const events = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const recordSession = yield* changeSets
						.commit(
							ownerCreate({ ...originalCreate, name: "Record Session" }),
							command("record-session-cascade"),
						)
						.pipe(Effect.flatMap(savedEntity));
					const record = yield* changeSets
						.commit(
							ownerCreate({ ...originalCreate, name: "Record Set" }),
							command("record-set-cascade"),
						)
						.pipe(Effect.flatMap(savedEntity));
					const eventIds = [EventId.make("record-event-1"), EventId.make("record-event-2")];
					for (const eventId of eventIds) {
						yield* createEvent(eventId, owner, record.id, recordSession.id);
					}
					const lifecycle = command("record-session-delete");
					const deleted = yield* changeSets.commit(deletesOf(owner, [recordSession.id]), lifecycle);
					expect(deleted.deleted).toEqual([recordSession.id]);
					expect(yield* session.run((db) => db.select().from(tables.event))).toEqual([]);
					const triggers = yield* session.run((db) =>
						db
							.select()
							.from(tables.automationTrigger)
							.where(eq(tables.automationTrigger.executionId, lifecycle.causation.executionId)),
					);
					const eventDeletes = triggers.filter(
						({ category, operation, resourceKind }) =>
							category === "change" && resourceKind === "event" && operation === "delete",
					);
					const eventBatches = triggers.filter(
						({ category, operation, resourceKind }) =>
							category === "change" && resourceKind === "event" && operation === "batch",
					);
					expect(
						eventDeletes.map(({ payload }) =>
							payload?.category === "change" &&
							payload.resource === "event" &&
							payload.operation === "delete"
								? payload.before.id
								: null,
						),
					).toEqual(eventIds);
					expect(eventBatches).toHaveLength(1);
					assert(eventBatches[0]?.payload?.operation === "batch");
					expect(eventBatches[0].payload.items).toHaveLength(2);
					expect(yield* events.listEventIdentitiesForEntities([recordSession.id])).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer({ lateEventOnDelete: true, policies: [{ action: "allow" }] }))(
		"entities service harness",
		(test) => {
			test.effect(
				"rolls back a cascade when an event appears after deletion preparation",
				() =>
					Effect.gen(function* () {
						const changeSets = yield* ChangeSets;
						const events = yield* EventsRepository;
						const session = yield* DatabaseSession;
						const create = (id: string) =>
							changeSets.commit(ownerCreate(), command(id)).pipe(Effect.flatMap(savedEntity));
						const recordSession = yield* create("late-event-session");
						const record = yield* create("late-event-record");
						yield* createEvent(
							EventId.make("initial-cascade-event"),
							owner,
							record.id,
							recordSession.id,
						);
						assertExitFails(
							yield* Effect.exit(
								changeSets.commit(
									deletesOf(owner, [recordSession.id]),
									command("late-event-delete"),
								),
							),
							new EntityBadRequest({ reason: { code: "mutation-conflict" } }),
						);
						expect(yield* (yield* EntitiesRepository).getById(recordSession.id)).toEqual<unknown>(
							recordSession,
						);
						expect(yield* events.listEventIdentitiesForEntities([recordSession.id])).toHaveLength(
							2,
						);
						expect(
							(yield* session.run((db) => db.select().from(tables.automationTrigger))).filter(
								({ category, operation, resourceKind }) =>
									category === "change" &&
									resourceKind === "event" &&
									(operation === "delete" || operation === "batch"),
							),
						).toEqual([]);
					}),
				testTimeout,
			);
		},
	);

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"rejects a history-preserving delete when an event appears after its preparation",
			() =>
				Effect.gen(function* () {
					const entities = yield* EntitiesService;
					const session = yield* DatabaseSession;
					const record = yield* (yield* ChangeSets)
						.commit(ownerCreate(), command("history-record"))
						.pipe(Effect.flatMap(savedEntity));
					const prepared = yield* entities.prepareDeletes(
						new WritePreparation(),
						[record.id],
						command("history-delete"),
						{ entitySchema, scopeUserId: owner, preserveHistory: true },
					);
					yield* createEvent(EventId.make("late-history-event"), owner, record.id);
					assertExitFails(
						yield* Effect.exit(
							session.transaction(
								entities.persistPreparedDeletes(new WriteTransaction(), prepared),
							),
						),
						new EntityBadRequest({ reason: { code: "entity-has-history" } }),
					);
					expect(yield* (yield* EntitiesRepository).getById(record.id)).toEqual<unknown>(record);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"constrains user deletion to its owner and definition and replays its cascade",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const events = yield* EventsRepository;
					const create = (id: string) =>
						changeSets.commit(ownerCreate(), command(id)).pipe(Effect.flatMap(savedEntity));
					const record = yield* create("scoped-delete-record");
					const part = yield* create("scoped-delete-part");
					yield* createEvent(EventId.make("scoped-delete-set"), owner, part.id, record.id);
					for (const [index, denied] of [
						deletesOf(UserId.make("another-owner"), [record.id]),
						deletesOf(owner, [record.id], { slug, owner: definitionOwner("another-plugin") }),
						deletesOf(owner, [record.id], {
							owner: entitySchema.owner,
							slug: EntitySchemaSlug.make("another-schema"),
						}),
					].entries()) {
						expect(
							yield* changeSets.commit(denied, command(`scoped-denied-${index}`)).pipe(Effect.flip),
						).toMatchObject({
							_tag: "EntityNotFound",
							reason: { entityId: record.id, code: "entity-not-found" },
						});
					}
					expect(
						(yield* changeSets.commit(deletesOf(owner, [record.id]), command("scoped-delete")))
							.deleted,
					).toEqual([record.id]);
					expect(yield* events.listEventIdentitiesForEntities([part.id])).toEqual([]);
					expect(yield* (yield* EntitiesRepository).getById(part.id)).toEqual<unknown>(part);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer({ noHooks: true }))("entities service harness", (test) => {
		test.effect(
			"rejects a second kernel collection with the same trimmed name per user",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const collection = {
						owner: { kind: "kernel" as const },
						slug: EntitySchemaSlug.make("collection"),
					};
					const create = (id: string, name: string) =>
						changeSets
							.commit(ownerCreate({ name, properties: {}, entitySchema: collection }), command(id))
							.pipe(Effect.flatMap(savedEntity));
					const first = yield* create("collection-first", "Favorites");
					const other = yield* create("collection-other", "Other");
					yield* changeSets.commit(
						ownerCreate({ ...originalCreate, name: "Favorites" }),
						command("record-same-name"),
					);
					const duplicate = new EntityBadRequest({ reason: { code: "duplicate-collection-name" } });
					assertExitFails(
						yield* Effect.exit(create("collection-second", " Favorites ")),
						duplicate,
					);
					assertExitFails(
						yield* Effect.exit(
							changeSets.commit(
								{ userId: owner, entities: { updates: [entityUpdate(other, "Favorites", {})] } },
								command("collection-rename"),
							),
						),
						duplicate,
					);
					expect(yield* (yield* EntitiesRepository).getById(other.id)).toMatchObject({
						name: "Other",
					});
					expect(first.name).toBe("Favorites");
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"does not allow a user-scoped delete to remove a global entity",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const global = yield* changeSets
						.commit(
							{
								userId: null,
								entities: {
									creates: [{ entitySchema, name: "Global", properties: { title: "global" } }],
								},
							},
							systemCommand("scoped-global-create"),
						)
						.pipe(Effect.flatMap(savedEntity));
					expect(
						yield* changeSets
							.commit(deletesOf(owner, [global.id]), command("scoped-global-delete"))
							.pipe(Effect.flip),
					).toMatchObject({ _tag: "EntityNotFound" });
					expect(yield* (yield* EntitiesRepository).getById(global.id)).toEqual<unknown>(global);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"deletes an event once when both entity reference roles match the batch",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const session = yield* DatabaseSession;
					const create = (id: string) =>
						changeSets.commit(ownerCreate(), command(id)).pipe(Effect.flatMap(savedEntity));
					const primary = yield* create("overlap-primary");
					const sessionEntity = yield* create("overlap-session");
					const eventId = EventId.make("overlapping-event");
					yield* createEvent(eventId, owner, primary.id, sessionEntity.id);
					expect(
						(yield* changeSets.commit(
							deletesOf(owner, [primary.id, sessionEntity.id]),
							command("overlap-cascade-delete"),
						)).deleted,
					).toHaveLength(2);
					const eventDeletes = (yield* session.run((db) =>
						db.select().from(tables.automationTrigger),
					))
						.filter(
							({ category, operation, resourceKind }) =>
								category === "change" && resourceKind === "event" && operation === "delete",
						)
						.map(({ payload }) =>
							payload?.category === "change" &&
							payload.resource === "event" &&
							payload.operation === "delete"
								? payload.before.id
								: null,
						);
					expect(eventDeletes).toEqual([eventId]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"deletes events for every user of a global entity",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const session = yield* DatabaseSession;
					const secondUser = UserId.make("second-owner");
					yield* session.run((db) =>
						db
							.insert(tables.user)
							.values({ id: secondUser, name: "Second owner", email: "second@example.test" }),
					);
					const globalEntity = yield* changeSets
						.commit(
							{
								userId: null,
								entities: {
									creates: [{ entitySchema, name: "Global", properties: { title: "global" } }],
								},
							},
							systemCommand("global-create"),
						)
						.pipe(Effect.flatMap(savedEntity));
					const eventIds: [EventId, EventId] = [
						EventId.make("global-event-owner"),
						EventId.make("global-event-second"),
					];
					yield* createEvent(eventIds[0], owner, globalEntity.id);
					yield* createEvent(eventIds[1], secondUser, globalEntity.id);
					yield* changeSets.commit(
						deletesOf(null, [globalEntity.id]),
						systemCommand("global-cascade-delete"),
					);

					expect(yield* session.run((db) => db.select().from(tables.event))).toEqual([]);
					const eventChanges = (yield* session.run((db) =>
						db.select().from(tables.automationTrigger),
					))
						.filter(
							({ category, operation, resourceKind }) =>
								category === "change" && resourceKind === "event" && operation === "delete",
						)
						.map(({ payload }) =>
							payload?.category === "change" &&
							payload.resource === "event" &&
							payload.operation === "delete"
								? payload.before.id
								: null,
						);
					expect(eventChanges).toEqual(eventIds);
					const eventBatches = (yield* session.run((db) =>
						db.select().from(tables.automationTrigger),
					)).filter(
						({ category, operation, resourceKind }) =>
							category === "change" && resourceKind === "event" && operation === "batch",
					);
					expect(
						eventBatches
							.map(({ scopeUserId }) => scopeUserId)
							.sort((left, right) => (left ?? "").localeCompare(right ?? "")),
					).toEqual([owner, secondUser]);
				}),
			testTimeout,
		);
	});

	const providerId = SandboxProviderId.make("fixture-provider");
	const providerEntitySchema: EntitySchemaReference = {
		slug,
		owner: definitionOwner("provider-plugin"),
	};
	const otherProviderEntitySchema: EntitySchemaReference = {
		owner: definitionOwner("provider-plugin"),
		slug: EntitySchemaSlug.make("other-record"),
	};
	const seedProvider = Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const declarations = yield* DefinitionRepository.make.pipe(
			Effect.provideServiceEffect(DefinitionCatalog, DefinitionCatalog.make),
		);
		const kernelSchema = yield* declarations.findGlobalEntitySchema(entitySchema);
		assert(kernelSchema);
		const source = revisionPackage("provider", "v1", slug).manifest;
		const manifest = {
			...source,
			entitySchemas: Array.from(source.entitySchemas, (definition) => ({
				...definition,
				propertiesSchema: mapAppSchemaText(kernelSchema.propertiesSchema, (text) =>
					typeof text === "string" ? { key: "test.kernel-property" } : text,
				),
			})).flatMap((definition) => [
				definition,
				{ ...definition, slug: otherProviderEntitySchema.slug },
			]),
		};
		yield* session.transaction(
			session.run((db) =>
				Effect.gen(function* () {
					yield* db
						.insert(tables.plugin)
						.values({
							status: "inactive",
							id: "provider-plugin",
							packageId: manifest.metadata.packageId,
						});
					yield* insertPluginRevision(db, {
						manifest,
						id: "provider-revision",
						pluginId: "provider-plugin",
						contentHash: "provider-source",
					});
					yield* db
						.update(tables.plugin)
						.set({ status: "active", activeRevisionId: "provider-revision" })
						.where(eq(tables.plugin.id, "provider-plugin"));
					yield* db
						.insert(tables.sandboxProvider)
						.values({
							id: providerId,
							slug: "provider",
							rootEntitySchemaSlug: slug,
							pluginId: "provider-plugin",
							information: { source: "fixture" },
							name: { key: "test.provider", namespace: "provider-plugin" },
						});
				}),
			),
		);
		yield* (yield* DefinitionRepository.make.pipe(
			Effect.provideServiceEffect(DefinitionCatalog, DefinitionCatalog.make),
		)).writeRevisionDefinitions({
			pluginId: "provider-plugin",
			pluginRevisionId: "provider-revision",
			definitions: revisionDefinitions("provider-plugin", manifest),
		});
	});
	/** A kernel writer's provider upsert of `externalId`, updating an existing entity. */
	const providerUpsert = (externalId: string): GlobalUpsert => ({
		externalId,
		name: externalId,
		populatedAt: null,
		properties: { title: externalId },
		entitySchema: providerEntitySchema,
		provider: { providerId, updateExisting: true },
	});
	const changeTriggers = Effect.flatMap(DatabaseSession, (session) =>
		session.run((db) =>
			db
				.select()
				.from(tables.automationTrigger)
				.where(eq(tables.automationTrigger.category, "change"))
				.orderBy(tables.automationTrigger.createdAt, tables.automationTrigger.operation),
		),
	);
	const installProvider = Effect.fn(function* (scope: "user" | "system") {
		yield* seedProvider;
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			Effect.gen(function* () {
				if (scope === "user") {
					yield* db
						.update(tables.plugin)
						.set({ ownerId: owner })
						.where(eq(tables.plugin.id, "provider-plugin"));
				}
				yield* db
					.insert(tables.pluginInstallation)
					.values({ userId: owner, pluginId: "provider-plugin" });
			}),
		);
	});
	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"rejects ordinary private-provider edits but permits provider corrections",
			() =>
				Effect.gen(function* () {
					yield* installProvider("user");
					const service = yield* EntitiesService;
					const changeSets = yield* ChangeSets;
					const repository = yield* EntitiesRepository;
					const providerCreate = (name: string, properties: unknown) =>
						ownerCreate({
							name,
							properties,
							externalId: "private-source",
							entitySchema: providerEntitySchema,
							provider: { providerId, updateExisting: true },
						});
					const entity = yield* changeSets
						.commit(
							providerCreate(" Original ", { code: "original", title: "original" }),
							command("private-provider-create"),
						)
						.pipe(Effect.flatMap(savedEntity));
					const refusal = new EntityNotFound({
						reason: { entityId: entity.id, code: "entity-not-found" },
					});
					assertExitFails(
						yield* Effect.exit(
							changeSets.commit(
								{
									userId: owner,
									entities: { updates: [entityUpdate(entity, "User edit", { title: "user" })] },
								},
								command("private-provider-edit"),
							),
						),
						refusal,
					);
					assertExitFails(
						yield* Effect.exit(
							service.prepareSave(new WritePreparation(), {
								scopeUserId: owner,
								name: "Editor edit",
								properties: { title: "editor" },
								entitySchema: providerEntitySchema,
								lifecycle: command("private-provider-editor"),
								target: entityUpdate(entity, "Editor edit", {}).target,
							}),
						),
						refusal,
					);
					expect((yield* repository.getById(entity.id))?.name).toBe(entity.name);
					const corrected = yield* changeSets
						.commit(
							providerCreate("Source correction", { title: "source", code: "corrected" }),
							command("private-provider-correction"),
						)
						.pipe(Effect.flatMap(savedEntity));
					expect(corrected).toMatchObject({
						name: "Source correction",
						properties: { title: "source", code: "corrected" },
					});
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"rechecks provider ownership when committing a prepared user save",
			() =>
				Effect.gen(function* () {
					yield* installProvider("user");
					const service = yield* EntitiesService;
					const session = yield* DatabaseSession;
					const entity = yield* (yield* ChangeSets)
						.commit(
							ownerCreate({ ...originalCreate, entitySchema: providerEntitySchema }),
							command("prepared-custom-create"),
						)
						.pipe(Effect.flatMap(savedEntity));
					const lifecycle = command("prepared-custom-update");
					const prepared = yield* service.prepareSave(new WritePreparation(), {
						lifecycle,
						name: "User edit",
						scopeUserId: owner,
						properties: { title: "user" },
						entitySchema: providerEntitySchema,
						target: entityUpdate(entity, "User edit", {}).target,
					});
					yield* session.run((db) =>
						db
							.update(tables.entity)
							.set({ providerId, externalId: "attached-source" })
							.where(eq(tables.entity.id, entity.id)),
					);
					assertExitFails(
						yield* Effect.exit(
							session.transaction(
								service.persistPreparedSaves(
									new WriteTransaction(),
									[prepared],
									acceptPrepared,
									{ command: lifecycle, identity: ["entities"] },
									0,
								),
							),
						),
						new EntityNotFound({ reason: { entityId: entity.id, code: "entity-not-found" } }),
					);
					expect((yield* (yield* EntitiesRepository).getById(entity.id))?.name).toBe(entity.name);
				}),
			testTimeout,
		);
	});
	layer(
		entitiesLayer({
			policies: [{ action: "allow" }],
			policyEntityProvenance: { providerId, entityId: EntityId.make("policy-provider-entity") },
		}),
	)("entities service harness", (test) => {
		test.effect(
			"rechecks user-only updates after policies change provider ownership",
			() =>
				Effect.gen(function* () {
					yield* installProvider("user");
					const repository = yield* EntitiesRepository;
					const entityId = EntityId.make("policy-provider-entity");
					const [stored] = yield* repository.insertEntities([
						{
							id: entityId,
							scope: "user",
							userId: owner,
							properties: {},
							name: "Original",
							entitySchemaSlug: slug,
							entitySchemaPluginId: "provider-plugin",
						},
					]);
					assert(stored);
					assertExitFails(
						yield* Effect.exit(
							(yield* ChangeSets).commit(
								{ userId: owner, entities: { updates: [entityUpdate(stored, "User edit", {})] } },
								command("policy-provider-update"),
							),
						),
						new EntityNotFound({ reason: { entityId, code: "entity-not-found" } }),
					);
					expect((yield* repository.getById(entityId))?.name).toBe("Original");
				}),
			testTimeout,
		);
	});
	for (const planned of [false, true]) {
		layer(entitiesLayer())("entities service harness", (test) => {
			test.effect(
				`rejects private system-provider entities in ${planned ? "planned" : "ordinary"} upserts`,
				() =>
					Effect.gen(function* () {
						yield* installProvider("system");
						const session = yield* DatabaseSession;
						const lifecycle = command("private-system-provider-upsert");
						const mismatch = new EntityBadRequest({ reason: { code: "provider-scope-mismatch" } });
						if (planned) {
							assertExitFails(
								yield* Effect.exit(
									commitUpserts(
										[
											{
												...providerUpsert("external"),
												name: originalCreate.name,
												properties: originalCreate.properties,
											},
										],
										lifecycle,
										owner,
									),
								),
								mismatch,
							);
						} else {
							assertExitFails(
								yield* Effect.exit(
									(yield* ChangeSets).commit(
										ownerCreate({
											...originalCreate,
											externalId: "external",
											entitySchema: providerEntitySchema,
											provider: { providerId, updateExisting: true },
										}),
										lifecycle,
									),
								),
								mismatch,
							);
						}
						expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
					}),
				testTimeout,
			);
		});
	}
	for (const scope of ["system", "user"] as const) {
		layer(entitiesLayer())("entities service harness", (test) => {
			test.effect(
				`keeps custom entities private and distinct from ${scope}-provider entities`,
				() =>
					Effect.gen(function* () {
						yield* installProvider(scope);
						const changeSets = yield* ChangeSets;
						const session = yield* DatabaseSession;
						const create = { ...originalCreate, entitySchema: providerEntitySchema };
						const custom = yield* changeSets
							.commit(ownerCreate(create), command("custom-entity"))
							.pipe(Effect.flatMap(savedEntity));
						const supplied = {
							...create,
							externalId: "external",
							provider: { providerId, updateExisting: false },
						};
						const providerEntity = yield* changeSets
							.commit(
								{ entities: { creates: [supplied] }, userId: scope === "system" ? null : owner },
								command("provider-entity"),
							)
							.pipe(Effect.flatMap(savedEntity));
						expect(custom.id).not.toBe(providerEntity.id);
						expect(custom).toMatchObject({ externalId: null, providerId: null });
						const rows = yield* session.run((db) => db.select().from(tables.entity));
						expect(rows).toHaveLength(2);
						expect(rows.find(({ id }) => id === custom.id)).toMatchObject({ userId: owner });
						expect(rows.find(({ id }) => id === providerEntity.id)).toMatchObject({
							providerId,
							userId: scope === "system" ? null : owner,
						});
					}),
				testTimeout,
			);
		});
	}
	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"persists provider provenance and population-only updates; existing provider create is a noop",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const changeSets = yield* ChangeSets;
					const session = yield* DatabaseSession;
					const upsert = (id: string, name: string, populatedAt: null | string) =>
						changeSets
							.commit(
								{
									userId: null,
									entities: {
										creates: [
											{
												name,
												populatedAt,
												externalId: "external",
												properties: { title: "global" },
												entitySchema: providerEntitySchema,
												provider: { providerId, updateExisting: false },
											},
										],
									},
								},
								command(id),
							)
							.pipe(Effect.flatMap(savedEntity));
					const created = yield* upsert("global", "Global", null);
					expect(created).toMatchObject({ providerId, populatedAt: null, externalId: "external" });
					const updated = yield* upsert("population", "Global", "2026-09-15T01:00:00.000Z");
					expect(updated).toMatchObject({
						id: created.id,
						populatedAt: "2026-09-15T01:00:00.000Z",
					});
					const noop = yield* upsert("upsert-noop", "Ignored", null);
					expect(noop).toEqual(updated);

					expect(
						(yield* session.run((db) => db.select().from(tables.automationTrigger))).filter(
							(row) => row.category === "change",
						).length,
					).toBe(4);
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer({ failChange: true }))("entities service harness", (test) => {
		test.effect(
			"atomically rolls a no-policy source and change plan back on planning failure",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					expect(
						yield* (yield* ChangeSets).commit(ownerCreate(), command("rollback")).pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError", message: "Injected planning failure after insert" });
					const [entities, triggers] = yield* session.run((db) =>
						Effect.all([
							db.select().from(tables.entity),
							db.select().from(tables.automationTrigger),
						]),
					);
					expect(entities).toEqual([]);
					expect(triggers).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer({ deadlockOnce: true }))("entities service harness", (test) => {
		test.effect(
			"retries the entire source write and change plan after a deadlock",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const saved = yield* (yield* ChangeSets)
						.commit(ownerCreate(), command("deadlock-retry"))
						.pipe(Effect.flatMap(savedEntity));
					expect(
						(yield* session.run((db) => db.select().from(tables.entity))).map(({ id }) => id),
					).toEqual([saved.id]);
					expect(
						(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
							({ category, operation }) => ({ category, operation }),
						),
					).toEqual([
						{ category: "change", operation: "create" },
						{ category: "change", operation: "batch" },
					]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"persists the change trigger after commit",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const first = yield* (yield* ChangeSets)
						.commit(ownerCreate(), command("replay"))
						.pipe(Effect.flatMap(savedEntity));
					expect(first.name).toBe("Original");
					const [entities, triggers] = yield* session.run((db) =>
						Effect.all([
							db.select().from(tables.entity),
							db.select().from(tables.automationTrigger),
						]),
					);
					expect(entities).toHaveLength(1);
					expect(triggers.map(({ category }) => category)).toEqual(["change", "change"]);
					const change = triggers.find(
						(row) => row.category === "change" && row.operation === "create",
					);
					assert(change);
					expect(change.payload).toEqual<unknown>({
						after: first,
						category: "change",
						resource: "entity",
						operation: "create",
					});
					expect(change.parentTriggerId).toBeNull();
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"captures exact persisted update/delete snapshots and leaves noop timestamps untouched",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const session = yield* DatabaseSession;
					const created = yield* changeSets
						.commit(ownerCreate(), command("create"))
						.pipe(Effect.flatMap(savedEntity));
					const update = (id: string, entity: ListedEntity) =>
						changeSets
							.commit(
								{
									userId: owner,
									entities: {
										updates: [
											{
												...entityUpdate(entity, "Updated", { title: "updated" }),
												populatedAt: null,
											},
										],
									},
								},
								command(id),
							)
							.pipe(Effect.flatMap(savedEntity));
					const updated = yield* update("update", created);
					const noop = yield* update("noop", updated);
					expect(noop).toEqual(updated);
					const deleted = yield* changeSets.commit(
						deletesOf(owner, [created.id]),
						command("delete"),
					);
					expect(deleted.deleted).toEqual([created.id]);
					const changes = (yield* session.run((db) =>
						db.select().from(tables.automationTrigger),
					)).filter((row) => row.category === "change");
					expect(changes.length).toBe(6);
					expect(changes.find((row) => row.operation === "update")?.payload).toEqual<unknown>({
						after: updated,
						before: created,
						category: "change",
						resource: "entity",
						operation: "update",
					});
					expect(changes.find((row) => row.operation === "delete")?.payload).toEqual<unknown>({
						before: updated,
						category: "change",
						resource: "entity",
						operation: "delete",
					});
					expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
				}),
			testTimeout,
		);
	});

	for (const [name, options, code] of [
		[
			"rejected",
			{
				policies: [
					{ action: "reject", reason: { key: "rejection.denied" } },
					{ action: "reject", reason: { key: "rejection.not-executed" } },
				],
			},
			"policy-rejected",
		],
		[
			"failed",
			{ policies: ["fail", { action: "reject", reason: { key: "rejection.not-executed" } }] },
			"policy-execution-failed",
		],
	] as const) {
		layer(entitiesLayer(options))("entities service harness", (test) => {
			test.effect(
				`writes nothing for a ${name} request`,
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const error = yield* (yield* ChangeSets)
							.commit(ownerCreate(), command(name))
							.pipe(Effect.flip);
						expect(error).toMatchObject({ reason: { code }, _tag: "EntityBadRequest" });
						if (name === "failed") {
							expect(error).toMatchObject({ reason: { runId: "policy-0" } });
						}
						if (name === "rejected") {
							expect(error).toMatchObject({
								reason: { message: { key: "rejection.denied", namespace: "policy-plugin" } },
							});
						}
						expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
						expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
							[],
						);
						expect(yield* (yield* FakeEntityLifecycle).policyCalls).toEqual(["policy-0"]);
					}),
				testTimeout,
			);
		});
	}

	for (const [name, decision] of [
		["accepts", { action: "allow" }],
		["transforms", proposal("Changed", { title: "changed" })],
		["rejects", { action: "reject", reason: { key: "rejection.denied" } }],
	] as const) {
		layer(entitiesLayer({ policies: [decision] }))("entities service harness", (test) => {
			test.effect(
				`${name} a batch of entity creates with one policy call`,
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const titles = ["one", "two", "three"];
						const committed = yield* (yield* ChangeSets)
							.commit(
								{
									userId: owner,
									entities: {
										creates: titles.map((title) => ({
											name: title,
											entitySchema,
											itemIdentity: title,
											properties: { title },
										})),
									},
								},
								command(`batch-${name}`),
							)
							.pipe(Effect.result);
						expect(yield* (yield* FakeEntityLifecycle).policyCalls).toEqual(["policy-0"]);
						const rows = yield* session.run((db) =>
							db.select({ name: tables.entity.name }).from(tables.entity),
						);
						if (decision.action === "reject") {
							assert(committed._tag === "Failure");
							expect(committed.failure).toMatchObject({ reason: { code: "policy-rejected" } });
							expect(rows).toEqual([]);
							return;
						}
						assert(committed._tag === "Success");
						expect(committed.success.entities.map(({ entity }) => entity.properties)).toEqual(
							titles.map((title) => ({
								title: decision.action === "transform" ? "changed" : title,
							})),
						);
						expect(rows.map((row) => row.name).sort()).toEqual(
							decision.action === "transform" ? ["Changed", "Changed", "Changed"] : titles.sort(),
						);
					}),
				testTimeout,
			);
		});
	}

	layer(
		entitiesLayer({
			policies: [proposal("First", { title: "first" }), proposal("Second", { title: "second" })],
		}),
	)("entities service harness", (test) => {
		test.effect(
			"chains transforms in order then validates the final draft",
			() =>
				Effect.gen(function* () {
					expect(
						yield* (yield* ChangeSets)
							.commit(ownerCreate(), command("transform"))
							.pipe(Effect.flatMap(savedEntity)),
					).toMatchObject({ name: "Second", properties: { title: "second" } });
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer({ policies: [proposal("Changed", { title: "changed" })] }))(
		"entities service harness",
		(test) => {
			test.effect(
				"applies only the fields exposed by a strict entity patch",
				() =>
					Effect.gen(function* () {
						expect(
							yield* (yield* ChangeSets)
								.commit(ownerCreate(), command("identity"))
								.pipe(Effect.flatMap(savedEntity)),
						).toMatchObject({ name: "Changed", properties: { title: "changed" } });
					}),
				testTimeout,
			);
		},
	);

	layer(
		entitiesLayer({
			policies: [
				{
					action: "transform",
					patch: { resource: "entity", draft: { properties: { remove: [], set: { title: 42 } } } },
				},
			],
		}),
	)("entities service harness", (test) => {
		test.effect(
			"revalidates transformed properties against AppSchema",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					expect(
						yield* (yield* ChangeSets).commit(ownerCreate(), command("invalid")).pipe(Effect.flip),
					).toMatchObject({ reason: { paths: [["title"]], code: "invalid-properties" } });
					expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"rejects enclosing caller transactions before request planning",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const error = yield* session
						.transaction((yield* ChangeSets).commit(ownerCreate(), command("nested")))
						.pipe(Effect.flip);

					expect(error).toMatchObject({ reason: { code: "enclosing-transaction" } });
					expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
						[],
					);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"creates and upserts global entities by provider identity through change sets",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const changeSets = yield* ChangeSets;
					const session = yield* DatabaseSession;
					const upsert = (id: string, name: string, updateExisting: boolean) =>
						changeSets
							.commit(
								{
									userId: null,
									entities: {
										creates: [
											{
												name,
												properties: { title: name },
												externalId: "global-source",
												entitySchema: providerEntitySchema,
												populatedAt: "2026-09-15T00:00:00.000Z",
												provider: { providerId, updateExisting },
											},
										],
									},
								},
								command(id),
							)
							.pipe(Effect.flatMap(savedEntity));
					const created = yield* upsert("global-create", "Global", false);
					expect(yield* upsert("global-kept", "Ignored", false)).toEqual(created);
					expect(yield* upsert("global-upsert", "Updated", true)).toMatchObject({
						providerId,
						id: created.id,
						name: "Updated",
						externalId: "global-source",
					});
					expect(
						yield* session.run((db) =>
							db.select({ id: tables.entity.id, userId: tables.entity.userId }).from(tables.entity),
						),
					).toEqual([{ userId: null, id: created.id }]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"plans an entity change and its batch for a global upsert and nothing for an unchanged one",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const planned = { ...providerUpsert("planned"), name: "Planned" };
					const [created] = yield* commitUpserts([planned], command("planned"));
					expect(created?.name).toBe("Planned");
					const triggers = yield* changeTriggers;
					expect(
						triggers.map(({ operation, resourceKind }) => ({ operation, resourceKind })),
					).toEqual([
						{ operation: "batch", resourceKind: "entity" },
						{ operation: "create", resourceKind: "entity" },
					]);
					const batch = triggers[0]?.payload;
					assert(batch?.operation === "batch");
					expect(batch.items).toEqual<unknown>([triggers[1]?.payload]);
					const newer = { ...planned, name: "Newer", properties: { title: "newer" } };
					const updated = yield* commitUpserts([newer], command("planned-newer"));
					const changes = (yield* changeTriggers).length;
					expect(yield* commitUpserts([newer], command("planned-noop"))).toEqual(updated);
					expect(yield* changeTriggers).toHaveLength(changes);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"preserves population stamps without emitting timestamp-only changes and replays the result",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const populatedAt = "2026-10-01T00:00:00.000Z";
					const later = "2026-10-02T00:00:00.000Z";
					const input = { ...providerUpsert("preserved-stamp"), populatedAt, name: "Populated" };
					const first = yield* commitUpserts([input], command("preserved-stamp-create"));
					const changes = (yield* changeTriggers).length;
					const preserve = { ...input, populatedAt: later, preservePopulatedAt: true as const };
					const noop = yield* commitUpserts([preserve], command("preserved-stamp-ensure"));
					expect(noop).toEqual(first);
					expect(yield* commitUpserts([preserve], command("preserved-stamp-ensure"))).toEqual(noop);
					expect(yield* changeTriggers).toHaveLength(changes);
					const [changed] = yield* commitUpserts(
						[{ ...preserve, properties: { title: "Upgraded" } }],
						command("preserved-stamp-changed"),
					);
					expect(changed).toMatchObject({ populatedAt, properties: { title: "Upgraded" } });
					const [refreshed] = yield* commitUpserts(
						[{ ...input, populatedAt: later }],
						command("preserved-stamp-refresh"),
					);
					expect(refreshed?.populatedAt).toBe(later);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"covers one batch-scoped provider write with a single batch trigger",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const written = yield* commitUpserts(
						[providerUpsert("first"), providerUpsert("second")],
						command("planned-batch"),
					);
					expect(written.map(({ externalId }) => externalId)).toEqual(["first", "second"]);
					const triggers = yield* changeTriggers;
					expect(triggers.map(({ operation }) => operation).sort()).toEqual([
						"batch",
						"create",
						"create",
					]);
					const batch = triggers.find(({ operation }) => operation === "batch")?.payload;
					assert(batch?.operation === "batch");
					expect(batch.items).toEqual<unknown>(
						expect.arrayContaining(
							triggers.flatMap(({ payload, operation }) =>
								operation === "create" ? [payload] : [],
							),
						),
					);
					expect(batch.items).toHaveLength(2);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer({ policies: [{ action: "allow" }] }))("entities service harness", (test) => {
		test.effect(
			"persists provider writes without planning before policies",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const session = yield* DatabaseSession;
					const lifecycle = yield* FakeEntityLifecycle;
					const [written] = yield* commitUpserts(
						[providerUpsert("policy")],
						command("planned-policy"),
					);
					expect(written?.properties).toEqual({ title: "policy" });
					const triggers = yield* session.run((db) =>
						db
							.select({ category: tables.automationTrigger.category })
							.from(tables.automationTrigger),
					);
					expect(triggers.filter(({ category }) => category === "request")).toEqual([]);
					expect(yield* lifecycle.policyCalls).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"ensures bootstrap entities without duplicate changes",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const session = yield* DatabaseSession;
					const ensures = {
						userId: owner,
						entities: {
							ensures: [{ entitySchema, name: "Routine", properties: { title: "routine" } }],
						},
					};
					const changes = session.run((db) =>
						db
							.select()
							.from(tables.automationTrigger)
							.where(eq(tables.automationTrigger.category, "change")),
					);
					yield* changeSets.commit(ensures, command("ensure"));
					const [ensured, ...others] = yield* session.run((db) => db.select().from(tables.entity));
					assert(ensured);
					expect(others).toEqual([]);
					expect(yield* changes).toHaveLength(2);
					yield* changeSets.commit(ensures, command("ensure-noop"));
					expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([ensured]);
					expect(yield* changes).toHaveLength(2);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer({ failChange: true }))("entities service harness", (test) => {
		test.effect(
			"rolls the entire ensure batch back when its change plan fails",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					yield* (yield* ChangeSets)
						.commit(
							{
								userId: owner,
								entities: {
									ensures: [{ entitySchema, name: "Routine", properties: { title: "routine" } }],
								},
							},
							command("ensure-rollback"),
						)
						.pipe(Effect.flip);
					expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
					expect(
						(yield* session.run((db) => db.select().from(tables.automationTrigger))).map(
							(row) => row.category,
						),
					).toEqual([]);
				}),
			testTimeout,
		);
	});

	layer(entitiesLayer({ recordStatements: {}, extraEntitySchemas: 20 }))(
		"entities service harness",
		(test) => {
			test.effect(
				"issues the same checks, locks, lookups and admission statements for 2 and 20 item commits",
				() =>
					Effect.gen(function* () {
						yield* seedProvider;
						const changeSets = yield* ChangeSets;
						const session = yield* DatabaseSession;
						const log = yield* StatementLog;
						yield* commitUpserts([providerUpsert("provider-warm")], command("provider-warm"));
						const sizes = [2, 20] as const;
						const commitCounts = <A, E, R>(write: (size: number) => Effect.Effect<A, E, R>) =>
							Effect.forEach(sizes, (size) =>
								write(size).pipe(
									Effect.andThen(log.lastTransaction),
									Effect.map(countStatementClasses),
								),
							);
						expectInvariant(
							yield* commitCounts((size) =>
								commitUpserts(
									Array.from({ length: size }, (_, index) =>
										providerUpsert(`provider-${size}-${index}`),
									),
									command(`provider-${size}`),
								),
							),
						);
						expectInvariant(
							yield* commitCounts((size) =>
								changeSets.commit(
									{
										userId: owner,
										entities: {
											ensures: Array.from({ length: size }, (_, index) => ({
												name: `ensure-${index}`,
												properties: { title: "ensured" },
												entitySchema: {
													owner: { kind: "kernel" as const },
													slug: EntitySchemaSlug.make(`record-${index}`),
												},
											})),
										},
									},
									command(`ensure-${size}`),
								),
							),
						);
						expectInvariant(
							yield* commitCounts((size) =>
								Effect.gen(function* () {
									const ids = Array.from({ length: size }, (_, index) =>
										EntityId.make(`delete-${size}-${index}`),
									);
									yield* session.run((db) =>
										db
											.insert(tables.entity)
											.values(
												ids.map((id) => ({
													id,
													name: id,
													userId: owner,
													entitySchemaSlug: slug,
													properties: { title: id },
												})),
											),
									);
									const deleted = yield* changeSets.commit(
										deletesOf(owner, ids),
										command(`delete-${size}`),
									);
									expect(deleted.deleted).toHaveLength(size);
								}),
							),
						);
					}),
				testTimeout,
			);
		},
	);

	layer(entitiesLayer({ noHooks: true, recordStatements: { holdLocks: /hashtextextended/ } }))(
		"entities service harness",
		(test) => {
			test.effect(
				"serializes single and batch provider writers on shared identities without deadlocks",
				() =>
					Effect.gen(function* () {
						yield* seedProvider;
						const changeSets = yield* ChangeSets;
						const session = yield* DatabaseSession;
						const log = yield* StatementLog;
						for (const round of ["first", "second"]) {
							const externalId = `contended-${round}`;
							const commitUpsert = (id: string) =>
								changeSets
									.commit(
										{
											userId: null,
											entities: {
												creates: [
													{
														externalId,
														name: externalId,
														populatedAt: null,
														properties: { title: externalId },
														entitySchema: providerEntitySchema,
														provider: { providerId, updateExisting: true },
													},
												],
											},
										},
										command(id),
									)
									.pipe(Effect.flatMap(savedEntity));
							const created = yield* commitUpsert(`seed-${round}`);
							const [single, batch] = yield* Effect.all(
								[
									commitUpsert(`single-${round}`),
									retryOnDeadlock(
										commitUpserts([providerUpsert(externalId)], command(`batch-${round}`)),
									),
								],
								{ concurrency: 2 },
							);
							const rows = yield* session.run((db) =>
								db.select().from(tables.entity).where(eq(tables.entity.externalId, externalId)),
							);
							expect(rows.map(({ id }) => id)).toEqual([created.id]);
							const stored = yield* (yield* EntitiesRepository).getById(created.id);
							assert(stored);
							expect(single).toEqual(stored);
							expect(batch).toEqual([stored]);
						}
						expect(yield* log.errorCodes).not.toContain("40P01");
					}),
				testTimeout,
			);
		},
	);

	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"deduplicates identical batch items and rejects conflicting duplicates before writing",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const changeSets = yield* ChangeSets;
					const session = yield* DatabaseSession;
					const lifecycle = command("duplicates");
					const [first, second] = yield* commitUpserts(
						[providerUpsert("same"), providerUpsert("same")],
						lifecycle,
					);
					assert(first && second);
					expect(second).toEqual(first);
					const conflicting = [
						[
							{ ...providerUpsert("other-command"), itemIdentity: "duplicate-left" },
							{ ...providerUpsert("other-command"), itemIdentity: "duplicate-right" },
						],
						[
							providerUpsert("other-input"),
							{ ...providerUpsert("other-input"), name: "Different" },
						],
					];
					for (const items of conflicting) {
						expect(yield* commitUpserts(items, lifecycle).pipe(Effect.flip)).toMatchObject({
							reason: { code: "mutation-conflict" },
						});
					}
					const ensureItem = { entitySchema, name: "Ensured", properties: { title: "ensured" } };
					yield* changeSets.commit(
						{ userId: owner, entities: { ensures: [ensureItem, ensureItem] } },
						command("ensure-duplicates"),
					);
					expect(
						yield* changeSets
							.commit(
								{
									userId: owner,
									entities: { ensures: [ensureItem, { ...ensureItem, name: "Different" }] },
								},
								command("ensure-conflict"),
							)
							.pipe(Effect.flip),
					).toMatchObject({ reason: { code: "mutation-conflict" } });
					expect(
						(yield* session.run((db) => db.select().from(tables.entity)))
							.map(({ name, externalId }) => externalId ?? name)
							.sort(),
					).toEqual(["Ensured", "same"]);
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"reports the first invalid provider item in input order before writing",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const session = yield* DatabaseSession;
					assertExitFails(
						yield* Effect.exit(
							commitUpserts(
								[
									{ ...providerUpsert("zeta"), properties: { title: 42 } },
									{ ...providerUpsert("Alpha"), properties: null },
								],
								command("invalid-provider-items"),
							),
						),
						new EntityBadRequest({ reason: { paths: [["title"]], code: "invalid-properties" } }),
					);
					expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"records provider-order results and change triggers",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const first = yield* commitUpserts(
						["zeta", "Alpha", "alpha"].map(providerUpsert),
						command("batch-replay"),
					);
					expect(first.map(({ externalId }) => externalId)).toEqual(["zeta", "Alpha", "alpha"]);
					expect(yield* changeTriggers).toHaveLength(4);
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer())("entities service harness", (test) => {
		test.effect(
			"matches batch rows only within each item's exact scope and owner",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const session = yield* DatabaseSession;
					const secondUser = UserId.make("second-scope-owner");
					yield* session.run((db) =>
						db
							.insert(tables.user)
							.values({ id: secondUser, name: "Second", email: "second-scope@example.test" }),
					);
					const populatedAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-14T00:00:00.000Z"));
					const row = (id: string, userId: null | UserId, entitySchemaPluginId: null | string) => ({
						id,
						userId,
						name: id,
						providerId,
						populatedAt,
						entitySchemaPluginId,
						externalId: "shared",
						entitySchemaSlug: slug,
						properties: { title: id },
					});
					yield* session.run((db) =>
						db
							.insert(tables.entity)
							.values([
								row("global-plugin", null, "provider-plugin"),
								row("global-kernel", null, null),
								row("owner-plugin", owner, "provider-plugin"),
								row("second-plugin", secondUser, "provider-plugin"),
								{
									id: "second-plain",
									userId: secondUser,
									name: "Second plain",
									entitySchemaSlug: slug,
									properties: { title: "second" },
									createdAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-01T00:00:00.000Z")),
								},
								{
									userId: owner,
									name: "Owner newer",
									entitySchemaSlug: slug,
									id: "owner-plain-newer",
									properties: { title: "newer" },
									createdAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-03T00:00:00.000Z")),
								},
								{
									userId: owner,
									name: "Owner older",
									entitySchemaSlug: slug,
									id: "owner-plain-older",
									properties: { title: "older" },
									createdAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-02T00:00:00.000Z")),
								},
							]),
					);
					const scoped = yield* commitUpserts(
						[{ ...providerUpsert("shared"), provider: { providerId, updateExisting: false } }],
						command("scoped-batch"),
					);
					expect(scoped.map(({ id }) => id)).toEqual<unknown>(["global-plugin"]);
					const rows = session.run((db) =>
						db.select({ id: tables.entity.id }).from(tables.entity).orderBy(tables.entity.id),
					);
					const before = yield* rows;
					yield* (yield* ChangeSets).commit(
						{
							userId: owner,
							entities: {
								ensures: [{ entitySchema, name: "Ensured", properties: { title: "ensured" } }],
							},
						},
						command("scoped-ensure"),
					);
					expect(yield* rows).toEqual(before);
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer({ noHooks: true }))("entities service harness", (test) => {
		test.effect(
			"commits a provider batch larger than one statement's bind parameter budget",
			() =>
				Effect.gen(function* () {
					yield* seedProvider;
					const session = yield* DatabaseSession;
					const items = Array.from({ length: 4_200 }, (_, index) =>
						providerUpsert(`bulk-${index}`),
					);
					const first = yield* commitUpserts(items, command("bind-budget"));
					expect(new Set(first.map(({ id }) => id)).size).toBe(4_200);
					expect(yield* commitUpserts(items, command("bind-budget"))).toEqual(first);
					expect(yield* session.run((db) => db.select().from(tables.entity))).toHaveLength(4_200);
				}),
			testTimeout,
		);
	});
	layer(entitiesLayer({ noHooks: true }))("entities service harness", (test) => {
		test.effect(
			"rejects another user's managed asset on entity create and update",
			() =>
				Effect.gen(function* () {
					const changeSets = yield* ChangeSets;
					const foreign = yield* insertManagedAsset(UserId.make("asset-foreign-owner"));
					expect(
						yield* changeSets
							.commit(
								ownerCreate({
									...originalCreate,
									properties: { image: foreign, title: "original" },
								}),
								command("foreign-asset-create"),
							)
							.pipe(Effect.flip),
					).toEqual(new EntityBadRequest({ reason: { code: "asset-forbidden" } }));
					const created = yield* changeSets
						.commit(ownerCreate(), command("foreign-asset-base"))
						.pipe(Effect.flatMap(savedEntity));
					expect(
						yield* changeSets
							.commit(
								{
									userId: owner,
									entities: {
										updates: [
											entityUpdate(created, "Changed", { image: foreign, title: "changed" }),
										],
									},
								},
								command("foreign-asset-update"),
							)
							.pipe(Effect.flip),
					).toEqual(new EntityBadRequest({ reason: { code: "asset-forbidden" } }));
				}),
			testTimeout,
		);

		test.effect(
			"rejects the owner's own managed asset on a global entity",
			() =>
				Effect.gen(function* () {
					const own = yield* insertManagedAsset(owner);
					expect(
						yield* (yield* ChangeSets)
							.commit(
								{
									userId: null,
									entities: {
										creates: [
											{ entitySchema, name: "Global", properties: { image: own, title: "global" } },
										],
									},
								},
								systemCommand("global-own-asset"),
							)
							.pipe(Effect.flip),
					).toEqual(new EntityBadRequest({ reason: { code: "asset-forbidden" } }));
				}),
			testTimeout,
		);
	});
});
