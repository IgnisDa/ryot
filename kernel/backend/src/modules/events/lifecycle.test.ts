import { describe, expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationEventSnapshot,
	type AutomationPolicyOutput,
	type AutomationRequestPayload,
	DEFAULT_AUTOMATION_RETRY_POLICY,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	EventBadRequest,
	EventCreateItemError,
	EventNotFound,
	EventStale,
	type UpdateEventItem,
} from "@ryot-app/contract/modules/events/schemas";
import {
	AutomationExecutionId,
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	ImportRunId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { testPluginPackageId } from "@ryot-app/contract/testing";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Redacted, Ref, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";
import { Client } from "pg";

import {
	insertManagedAsset,
	managedAssetProperty,
} from "#lib/domain/managed-asset-writes.test-support";
import {
	decidingPolicies,
	noHooksFixture,
	policyFixture,
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { LifecyclePolicies } from "#modules/automations/lifecycle/policies";
import {
	commitEventChanges,
	createEvents,
	eventChangeSets,
	eventDelete,
	eventMove,
	eventUpdate,
} from "#modules/changes/change-sets.test-support";
import type { EventChange } from "#modules/changes/changes";
import { ChangeSets } from "#modules/changes/service";
import { DefinitionCatalog } from "#modules/definitions/catalog";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { EntitiesRepository } from "#modules/entities/repository";
import {
	type DomainLifecycleCommand,
	DomainWriteChecksLive,
} from "#modules/entities/write-context";
import { ImportsRepository } from "#modules/imports/repository";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { DatabaseSession } from "#platform/db/session";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import * as tables from "#schema/tables/combined";
import {
	makeAppConfigLayer,
	makeConfigProviderLayer,
	makeWorkflowEngine,
	workflowAccountsTestLayer,
} from "#testing/effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#testing/isolated-database";

import { EventsRepository } from "./repository";

const failChanges = <A, E, R>(
	trigger: { kind: { category: string } },
	planned: Effect.Effect<A, E, R>,
) =>
	Effect.filterOrFail(
		planned,
		() => trigger.kind.category !== "change",
		() => new DbError({ message: "planning failed after run insertion" }),
	);

const userId = UserId.make("event-owner");
const entityId = EntityId.make("event-subject");
const movedId = EntityId.make("event-moved-subject");
const eventSchemaSlug = EventSchemaSlug.make("rating");
const now = "2026-09-15T00:00:00.000Z";
const editPropertiesSchema = {
	fields: {
		image: managedAssetProperty,
		note: { label: "Note", type: "string", description: "Note" },
		rating: { type: "number", label: "Rating", description: "Rating" },
	},
} as const;
const command = (id: string) => ({
	...rootLifecycleCommand({
		source: "api",
		occurredAt: now,
		lane: "interactive",
		itemIdentity: "event",
		accountUserId: userId,
		initiator: { id: userId, kind: "user" },
		executionId: AutomationExecutionId.make(id),
	}),
	writeContext: null,
});
const updateItem = (id: string, patch: UpdateEventItem["patch"]): UpdateEventItem => ({
	patch,
	eventId: EventId.make(id),
});
const updateEventProperties = (
	repository: EventsRepository["Service"],
	session: DatabaseSession["Service"],
	eventId: EventId,
	update: (
		properties: AutomationEventSnapshot["properties"],
	) => AutomationEventSnapshot["properties"],
) =>
	Effect.gen(function* () {
		const input = { userId, eventId };
		const current = yield* repository.getEventSnapshot(input);
		assert(current);
		const { snapshot, revision: expectedRevision } = current;
		const updated = yield* session.transaction(
			repository.updatePreparedEvent({
				...input,
				expectedRevision,
				propertiesSchema: { fields: {} },
				updatedAt: DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-16T00:00:00.000Z")),
				draft: {
					entityId: snapshot.entityId,
					occurredAt: snapshot.occurredAt,
					properties: update(snapshot.properties),
					eventSchemaSlug: snapshot.eventSchemaSlug,
					sessionEntityId: snapshot.sessionEntityId,
					entitySchemaSlug: snapshot.entitySchemaSlug,
					eventSchemaPluginId: snapshot.eventSchemaPluginId,
					entitySchemaPluginId: snapshot.entitySchemaPluginId,
				},
			}),
		);
		assert(updated);
	});

class LifecycleDatabase extends Context.Service<
	LifecycleDatabase,
	{
		readonly url: string;
		readonly observer: Client;
		readonly planTransactions: Effect.Effect<ReadonlyArray<string>>;
		readonly failChangePlanning: (fail: boolean) => Effect.Effect<void>;
	}
>()("@ryot-app/kernel-backend/modules/events/lifecycle.test/LifecycleDatabase") {}

const isolatedDatabase = Effect.gen(function* () {
	const { url } = yield* IsolatedDatabase;
	const observer = yield* Effect.acquireRelease(
		Effect.gen(function* () {
			const client = new Client({ connectionString: url });
			yield* Effect.promise(() => client.connect());
			return client;
		}),
		(client) => Effect.promise(() => client.end()),
	);
	yield* Effect.promise(() =>
		observer.query(`INSERT INTO "user" (id,name,email) VALUES ($1,'Owner','event@example.test');`, [
			userId,
		]),
	);
	yield* Effect.promise(() =>
		observer.query(
			`INSERT INTO entity (id,name,entity_schema_slug,properties) VALUES ($1,'Subject','record','{}'),($2,'Moved','record','{}')`,
			[entityId, movedId],
		),
	);
	yield* Effect.promise(() =>
		observer.query(
			`INSERT INTO sandbox_script (id,slug,name,source,content_hash,compiled_code,metadata) VALUES ('script','fixture','Fixture','','hash','','{}')`,
		),
	);
	return { url, observer };
});

const deleteTargets = [
	{
		eventSchemaSlug,
		resource: "event" as const,
		entitySchemaSlug: "record",
		operation: "delete" as const,
	},
];

type PolicyCall = { readonly runId: AutomationRunId; readonly request: AutomationRequestPayload };

const recordTransaction = Effect.fnUntraced(function* (
	session: DatabaseSession["Service"],
	transactions: Ref.Ref<ReadonlyArray<string>>,
) {
	const [transaction] = yield* session.run((db) =>
		db.execute<{ id: string }>(sql`select txid_current()::text as id`, "objects"),
	);
	if (transaction) {
		yield* Ref.update(transactions, (all) => [...all, transaction.id]);
	}
});

const planner = (
	failChange: Ref.Ref<boolean>,
	noHooks: boolean,
	transactions: Ref.Ref<ReadonlyArray<string>>,
) =>
	Layer.effect(
		LifecyclePlanner,
		Effect.map(DatabaseSession, (session) =>
			withLifecycleBatchPlanning(
				{
					plan: ({ trigger }) =>
						Effect.gen(function* () {
							yield* recordTransaction(session, transactions);
							if (noHooks) {
								return noHooksFixture();
							}
							const { kind, causation } = trigger;
							yield* session.run((db) =>
								db
									.insert(tables.automationTrigger)
									.values({
										id: trigger.id,
										lane: causation.lane,
										depth: causation.depth,
										category: kind.category,
										payload: trigger.payload,
										source: causation.source,
										operation: kind.operation,
										resourceKind: kind.resource,
										scopeUserId: trigger.scopeUserId,
										executionId: causation.executionId,
										parentRunId: causation.parentRunId,
										initiatorId: causation.initiator.id,
										initiatorKind: causation.initiator.kind,
										rootExecutionId: causation.rootExecutionId,
										parentTriggerId: causation.parentTriggerId,
										createdAt: DateTime.toDate(DateTime.makeUnsafe(trigger.createdAt)),
										occurredAt: DateTime.toDate(DateTime.makeUnsafe(trigger.occurredAt)),
									})
									.onConflictDoNothing(),
							);
							if (kind.category === "change") {
								yield* session.run((db) =>
									db
										.insert(tables.automationRun)
										.values({
											hookSlug: "fixture",
											hookName: "Fixture",
											triggerId: trigger.id,
											scriptSlug: "fixture",
											id: `run-${trigger.id}`,
											sandboxScriptId: "script",
											scriptContentHash: "hash",
											retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
											artifactsExpireAt: DateTime.toDate(DateTime.makeUnsafe(now)),
										})
										.onConflictDoNothing(),
								);
								if (yield* Ref.get(failChange)) {
									return yield* new DbError({ message: "planning failed after run insertion" });
								}
							}
							return { trigger, runs: [], wasCreated: true };
						}),
				},
				200,
				!noHooks,
			),
		),
	);

const workflowEntity = (requestedId: EntityId) => ({
	createdAt: now,
	updatedAt: now,
	properties: {},
	id: requestedId,
	name: "Subject",
	externalId: null,
	providerId: null,
	populatedAt: null,
	entitySchemaPluginId: null,
	entitySchemaSlug: EntitySchemaSlug.make("record"),
});
const workflowEventSchema = {
	slug: "rating",
	pluginId: null,
	id: eventSchemaSlug,
	propertiesSchema: { fields: {} },
	name: { key: "test.rating", namespace: "kernel" },
	entitySchemaSlug: EntitySchemaSlug.make("record"),
};
const workflowLayer = Layer.mergeAll(
	workflowAccountsTestLayer,
	Layer.mock(EntitiesRepository)({
		lockEntityReferencesByIds: () => Effect.void,
		getByIdForUser: ({ entityId: requestedId }) => Effect.succeed(workflowEntity(requestedId)),
		getByIdsForUser: ({ entityIds }) =>
			Effect.succeed(new Map(entityIds.map((id) => [id, workflowEntity(id)] as const))),
		getMutationEntities: (entityIds) =>
			Effect.succeed(new Map(entityIds.map((id) => [id, { userId, entity: workflowEntity(id) }]))),
		getEntityScopeForUser: ({ entityId: requestedId }) =>
			Effect.succeed({
				isBuiltin: false,
				entityUserId: userId,
				entityId: requestedId,
				entityName: "Subject",
				entitySchemaPluginId: null,
				propertiesSchema: { fields: {} },
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			}),
	}),
	Layer.mock(EventSchemaReader)({
		lockCatalog: () => Effect.void,
		getScopeForUser: () => Effect.succeed(workflowEventSchema),
		getScopesForUser: (_userId, inputs) => Effect.succeed(inputs.map(() => workflowEventSchema)),
	}),
);
const engine = makeWorkflowEngine({
	activityExecute: (activity) =>
		Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
});
const runCreate = (
	input: Parameters<typeof createEvents>[0],
	dependencies: {
		schemas?: EventSchemaReader["Service"];
		repository?: EventsRepository["Service"];
	} = {},
) =>
	Effect.gen(function* () {
		const repository = dependencies.repository ?? (yield* EventsRepository);
		const schemas = dependencies.schemas ?? (yield* EventSchemaReader);
		return yield* createEvents(input).pipe(
			Effect.provideServiceEffect(
				ChangeSets,
				eventChangeSets().pipe(
					Effect.provideService(EventsRepository, repository),
					Effect.provideService(EventSchemaReader, schemas),
				),
			),
		);
	});
const runChanges = (
	changes: ReadonlyArray<EventChange>,
	lifecycle: DomainLifecycleCommand,
	options: {
		readonly owner?: UserId;
		readonly planner?: LifecyclePlanner["Service"];
		readonly policies?: LifecyclePolicies["Service"];
	} = {},
) =>
	Effect.gen(function* () {
		const changeSets = yield* eventChangeSets().pipe(
			Effect.provideService(LifecyclePlanner, options.planner ?? (yield* LifecyclePlanner)),
			Effect.provideService(LifecyclePolicies, options.policies ?? (yield* LifecyclePolicies)),
		);
		return yield* commitEventChanges(options.owner ?? userId, lifecycle, changes).pipe(
			Effect.provideService(ChangeSets, changeSets),
		);
	});
const lifecycleDatabaseLayer = (
	noHooks = false,
	options: {
		policyCount?: number;
		changeEntityPropertiesDuringPolicy?: (call: number) => boolean;
		decidePolicy?: (
			input: PolicyCall,
			dependencies: {
				readonly session: DatabaseSession["Service"];
				readonly repository: EventsRepository["Service"];
			},
		) => Effect.Effect<AutomationPolicyOutput>;
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const database = yield* isolatedDatabase;
			const failChange = yield* Ref.make(false);
			const entityProperties = yield* Ref.make({ context: "stable" });
			const policyCalls = yield* Ref.make(0);
			const planTransactions = yield* Ref.make<ReadonlyArray<string>>([]);
			const config = makeAppConfigLayer({ database: { url: Redacted.make(database.url) } });
			const databaseSession = DatabaseSession.layer;
			const eventRepository = EventsRepository.layer.pipe(Layer.provideMerge(databaseSession));
			const execution = Layer.succeed(
				LifecycleExecution,
				withLifecycleDispatch({ after: () => Effect.void }),
			);
			const policies = Layer.effect(
				LifecyclePolicies,
				Effect.gen(function* () {
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					return decidingPolicies(
						(trigger) =>
							Effect.gen(function* () {
								yield* recordTransaction(session, planTransactions);
								const { kind, payload } = trigger;
								return kind.category === "request" &&
									(kind.operation === "update" ||
										(payload !== null &&
											"items" in payload &&
											payload.items.some((item) => item.operation === "update")))
									? Array.from({ length: options.policyCount ?? 0 }, (_, index) => ({
											...policyFixture(index, [
												{
													eventSchemaSlug,
													resource: "event",
													operation: "update",
													entitySchemaSlug: "record",
												},
											]),
											runId: AutomationRunId.make(`event-policy-${index}`),
										}))
									: [];
							}),
						({ request }, { runId }) =>
							(options.decidePolicy ?? (() => Effect.die("Unexpected policy")))(
								{ runId, request },
								{ session, repository },
							).pipe(
								Effect.tap(() =>
									Ref.updateAndGet(policyCalls, (calls) => calls + 1).pipe(
										Effect.flatMap((call) =>
											options.changeEntityPropertiesDuringPolicy?.(call)
												? Ref.set(entityProperties, { context: `changed-${call}` })
												: Effect.void,
										),
									),
								),
							),
					);
				}),
			).pipe(Layer.provideMerge(eventRepository));
			const entitySchemaSlug = EntitySchemaSlug.make("record");
			const entityReference = (requestedId: EntityId) => ({
				isBuiltin: true,
				entitySchemaSlug,
				entityUserId: userId,
				entityId: requestedId,
				entityName: "Subject",
				entitySchemaPluginId: null,
			});
			const eventSchemaScope = (input: {
				readonly eventSchemaSlug: string;
				readonly entitySchemaSlug: string;
			}) =>
				input.eventSchemaSlug === eventSchemaSlug && input.entitySchemaSlug === entitySchemaSlug
					? {
							pluginId: null,
							entitySchemaSlug,
							id: eventSchemaSlug,
							slug: eventSchemaSlug,
							propertiesSchema: editPropertiesSchema,
							name: { key: "test.rating", namespace: "kernel" },
						}
					: null;
			const listedEntity = (requestedId: EntityId, properties: Record<string, unknown>) => ({
				properties,
				createdAt: now,
				updatedAt: now,
				id: requestedId,
				name: "Subject",
				entitySchemaSlug,
				externalId: null,
				providerId: null,
				populatedAt: null,
				entitySchemaPluginId: null,
			});
			return Layer.mergeAll(
				WorkflowExecutionNotifications.layer,
				execution,
				policies,
				DomainWriteChecksLive.pipe(Layer.provide(databaseSession)),
				Layer.mock(EntitiesRepository)({
					lockEntityReferencesByIds: () => Effect.void,
					getEntityScopeForUser: ({ entityId: requestedEntityId }) =>
						Effect.succeed(
							requestedEntityId === "unreadable" ? null : entityReference(requestedEntityId),
						),
					getByIdForUser: ({ entityId: requestedEntityId }) =>
						Effect.gen(function* () {
							if (requestedEntityId === "unreadable") {
								return null;
							}
							return listedEntity(requestedEntityId, yield* Ref.get(entityProperties));
						}),
					getByIdsForUser: ({ entityIds }) =>
						Effect.map(
							Ref.get(entityProperties),
							(properties) =>
								new Map(
									entityIds.flatMap((id) =>
										id === "unreadable" ? [] : [[id, listedEntity(id, properties)] as const],
									),
								),
						),
					getMutationEntities: (entityIds) =>
						Effect.map(
							Ref.get(entityProperties),
							(properties) =>
								new Map(
									entityIds.flatMap((id) =>
										id === "unreadable"
											? []
											: [[id, { userId, entity: listedEntity(id, properties) }]],
									),
								),
						),
				}),
				Layer.mock(EventSchemaReader)({
					lockCatalog: () => Effect.void,
					getScopeForUser: (input) => Effect.succeed(eventSchemaScope(input)),
					getScopesForUser: (_userId, inputs) => Effect.succeed(inputs.map(eventSchemaScope)),
				}),
				ImportsRepository.layer.pipe(Layer.provideMerge(databaseSession)),
				planner(failChange, noHooks, planTransactions).pipe(Layer.provide(databaseSession)),
				Layer.succeed(WorkflowEngine, engine),
			).pipe(
				Layer.provideMerge(config),
				Layer.provideMerge(makeConfigProviderLayer()),
				Layer.provideMerge(
					Layer.succeed(LifecycleDatabase, {
						...database,
						planTransactions: Ref.get(planTransactions),
						failChangePlanning: (fail) => Ref.set(failChange, fail),
					}),
				),
			);
		}),
	).pipe(Layer.provide(isolatedDatabaseLayer("event_test")));

const createRatings = (id: string, count: number) =>
	runCreate({
		userId,
		command: command(id),
		payload: Array.from({ length: count }, (_, rating) => ({
			entityId,
			eventSchemaSlug,
			properties: { rating },
		})),
	}).pipe(
		Effect.provideService(LifecycleExecution, withLifecycleDispatch({ after: () => Effect.void })),
	);

describe("Event lifecycle PostgreSQL", () => {
	layer(Layer.merge(lifecycleDatabaseLayer(), workflowLayer))("event lifecycle harness", (test) => {
		test.effect(
			"replays committed event delivery after dispatch fails and keeps progress after history removal",
			() =>
				Effect.gen(function* () {
					const { observer } = yield* LifecycleDatabase;
					let dispatched = 0;
					const triggerIds: string[] = [];
					const payload = {
						userId,
						command: command("event-dispatch-recovery"),
						payload: [{ entityId, properties: {}, eventSchemaSlug }],
					};
					const run = () =>
						runCreate(payload).pipe(
							Effect.provideService(
								LifecycleExecution,
								withLifecycleDispatch({
									after: ({ triggerId }) =>
										Effect.sync(() => {
											dispatched += 1;
											triggerIds.push(triggerId);
											if (dispatched === 1) {
												throw new Error("Dispatch interrupted after commit");
											}
											return [];
										}),
								}),
							),
						);
					expect((yield* Effect.exit(run()))._tag).toBe("Failure");
					expect(
						(yield* Effect.promise(() =>
							observer.query("SELECT count(*)::int AS count FROM event"),
						)).rows,
					).toEqual([{ count: 1 }]);
					expect(
						(yield* Effect.promise(() =>
							observer.query("SELECT count(*)::int AS count FROM automation_run"),
						)).rows,
					).toEqual([{ count: 2 }]);
					expect((yield* run()).count).toBe(1);
					expect(dispatched).toBeGreaterThan(1);
					expect(triggerIds[1]).toBe(triggerIds[0]);
					expect(
						(yield* Effect.promise(() =>
							observer.query("SELECT count(*)::int AS count FROM event"),
						)).rows,
					).toEqual([{ count: 1 }]);
					yield* Effect.promise(() => observer.query("DELETE FROM automation_run"));
					yield* Effect.promise(() => observer.query("DELETE FROM automation_trigger"));
					expect((yield* run()).count).toBe(1);
				}),
			testTimeout,
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(), workflowLayer))("event lifecycle harness", (test) => {
		test.effect(
			"event, change trigger and queued runs commit together and roll back together",
			() =>
				Effect.gen(function* () {
					const { observer, failChangePlanning } = yield* LifecycleDatabase;
					const run = (id: string, fail: boolean) =>
						failChangePlanning(fail).pipe(
							Effect.andThen(
								runCreate({
									userId,
									command: command(id),
									payload: [{ entityId, properties: {}, eventSchemaSlug }],
								}),
							),
							Effect.provideService(
								LifecycleExecution,
								withLifecycleDispatch({
									after: () =>
										Effect.gen(function* () {
											const result = yield* Effect.promise(() =>
												observer.query(
													`SELECT (SELECT count(*) FROM event)::int AS events, (SELECT count(*) FROM automation_trigger WHERE category='change')::int AS changes, (SELECT count(*) FROM automation_run)::int AS runs`,
												),
											);
											expect(result.rows).toEqual([{ runs: 2, events: 1, changes: 2 }]);
											return [];
										}),
								}),
							),
						);
					assertExitFails(
						yield* Effect.exit(run("failed", true)),
						new DbError({ message: "planning failed after run insertion" }),
					);
					expect(
						(yield* Effect.promise(() =>
							observer.query(
								`SELECT (SELECT count(*) FROM event)::int AS events, (SELECT count(*) FROM automation_trigger)::int AS triggers, (SELECT count(*) FROM automation_run)::int AS runs`,
							),
						)).rows,
					).toEqual([{ runs: 0, events: 0, triggers: 0 }]);
					expect((yield* run("accepted", false)).count).toBe(1);
				}),
			testTimeout,
		);
	});

	layer(lifecycleDatabaseLayer())("event lifecycle harness", (test) => {
		test.effect(
			"conditional event edits and deletes reject stale input",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repository = yield* EventsRepository;
					const eventId = EventId.make("conditional-event");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: eventId,
							eventSchemaSlug,
							eventSchemaPluginId: null,
							properties: { rating: 3 },
							propertiesSchema: { fields: {} },
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					const before = yield* repository.getEventSnapshot({ userId, eventId });
					assert(before);
					const expected = {
						absentProperties: [],
						kind: "fields" as const,
						entityId: before.snapshot.entityId,
						occurredAt: before.snapshot.occurredAt,
						properties: before.snapshot.properties,
						sessionEntityId: before.snapshot.sessionEntityId,
					};
					const item = {
						eventId,
						expected,
						patch: { properties: { remove: [], set: { rating: 5 } } },
					};
					expect(yield* runChanges([eventUpdate(item)], command("conditional-edit"))).toEqual([
						eventId,
					]);
					assertExitFails(
						yield* Effect.exit(runChanges([eventUpdate(item)], command("stale-edit"))),
						new EventStale({ reason: { eventId, code: "event-stale" } }),
					);
					assertExitFails(
						yield* Effect.exit(
							runChanges([eventDelete(eventId, expected)], command("stale-delete")),
						),
						new EventStale({ reason: { eventId, code: "event-stale" } }),
					);
					const current = yield* repository.getEventSnapshot({ userId, eventId });
					assert(current);
					const deleteExpected = {
						absentProperties: [],
						kind: "fields" as const,
						entityId: current.snapshot.entityId,
						occurredAt: current.snapshot.occurredAt,
						properties: current.snapshot.properties,
						sessionEntityId: current.snapshot.sessionEntityId,
					};
					expect(
						yield* runChanges(
							[eventDelete(eventId, deleteExpected)],
							command("conditional-delete"),
						),
					).toEqual([eventId]);
					expect(yield* repository.getEventSnapshot({ userId, eventId })).toBeNull();
				}),
			testTimeout,
		);
	});

	layer(lifecycleDatabaseLayer())("event lifecycle harness", (test) => {
		test.effect(
			"snapshots preserve ownership and missing-row semantics",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repository = yield* EventsRepository;
					const eventId = EventId.make("replay-snapshot");
					const ownedEntityId = EntityId.make("replay-owned-subject");
					const identity = { userId, eventId };
					const otherIdentity = { eventId, userId: UserId.make("another-user") };
					expect(yield* repository.getEventSnapshot(identity)).toBeNull();
					yield* (yield* DatabaseSession).run((db) =>
						db
							.insert(tables.plugin)
							.values({ id: "event-plugin", status: "inactive", packageId: testPluginPackageId() }),
					);
					yield* session.run((db) =>
						db
							.insert(tables.entity)
							.values({
								properties: {},
								id: ownedEntityId,
								name: "Owned subject",
								entitySchemaSlug: "record",
								entitySchemaPluginId: "event-plugin",
							}),
					);
					yield* session.transaction(
						repository.createEvent({
							userId,
							id: eventId,
							eventSchemaSlug,
							entityId: ownedEntityId,
							sessionEntityId: movedId,
							properties: { rating: 5 },
							propertiesSchema: { fields: {} },
							eventSchemaPluginId: "event-plugin",
							occurredAt: DateTime.toDate(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					const current = yield* repository.getEventSnapshot(identity);
					assert(current);
					expect(current.revision).toBe(0);
					expect(current.snapshot).toMatchObject({
						sessionEntityId: movedId,
						properties: { rating: 5 },
						entitySchemaSlug: "record",
						eventSchemaPluginId: "event-plugin",
					});
					expect(current.snapshot).not.toHaveProperty("revision");
					expect(
						yield* repository.listEventIdentitiesForEntities([movedId, entityId, movedId]),
					).toEqual([{ userId, eventId }]);
					expect(yield* repository.getEventSnapshot(otherIdentity)).toBeNull();
				}),
			testTimeout,
		);

		test.effect(
			"reference moves and deletes retain exact snapshots and advance updatedAt",
			() =>
				Effect.gen(function* () {
					const { observer } = yield* LifecycleDatabase;
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const currentPlanner = yield* LifecyclePlanner;
					const failingPlanner = LifecyclePlanner.of({
						...currentPlanner,
						plan: (input) => failChanges(input.trigger, currentPlanner.plan(input)),
						planChange: (input) => failChanges(input.trigger, currentPlanner.planChange(input)),
						planChanges: (triggers) =>
							Effect.andThen(
								Effect.forEach(triggers, (trigger) => failChanges(trigger, Effect.void)),
								currentPlanner.planChanges(triggers),
							),
					});
					const eventId = EventId.make("event");
					const beforeTime = DateTime.toDate(DateTime.makeUnsafe("2025-01-01T00:00:00.000Z"));
					const created = yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: eventId,
							eventSchemaSlug,
							occurredAt: beforeTime,
							eventSchemaPluginId: null,
							properties: { rating: 3 },
							sessionEntityId: entityId,
							propertiesSchema: { fields: {} },
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					const replay = yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: eventId,
							eventSchemaSlug,
							occurredAt: beforeTime,
							eventSchemaPluginId: null,
							properties: { rating: 3 },
							sessionEntityId: entityId,
							propertiesSchema: { fields: {} },
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					expect(replay.id).toBe(eventId);
					assertExitFails(
						yield* Effect.exit(
							session.transaction(
								repository.createEvent({
									userId,
									entityId,
									id: eventId,
									eventSchemaSlug,
									occurredAt: beforeTime,
									eventSchemaPluginId: null,
									properties: { rating: 9 },
									sessionEntityId: entityId,
									propertiesSchema: { fields: {} },
									eventSchemaName: { key: "test.rating", namespace: "kernel" },
								}),
							),
						),
						new DbError({ message: "Conflicting event command identity" }),
					);
					const move = eventMove({ eventId, mergeInto: movedId, mergeFrom: entityId });
					yield* session.run((db) =>
						db
							.insert(tables.user)
							.values({ name: "Other", id: "not-owner", email: "not-owner-event@example.test" }),
					);
					assertExitFails(
						yield* Effect.exit(
							runChanges([move], command("failed-move"), { planner: failingPlanner }),
						),
						new DbError({ message: "planning failed after run insertion" }),
					);
					expect(yield* repository.getEventSnapshot({ userId, eventId })).toMatchObject({
						revision: 0,
						snapshot: { entityId, sessionEntityId: entityId, updatedAt: created.createdAt },
					});
					const notFound = new EventNotFound({ reason: { eventId, code: "event-not-found" } });
					assertExitFails(
						yield* Effect.exit(
							runChanges(
								[eventDelete(eventId)],
								{
									...rootLifecycleCommand({
										lane: "interactive",
										...command("not-owner"),
										source: "api",
										accountUserId: UserId.make("not-owner"),
										executionId: AutomationExecutionId.make("not-owner"),
										initiator: { kind: "user", id: UserId.make("not-owner") },
									}),
									writeContext: null,
								},
								{ owner: UserId.make("not-owner") },
							),
						),
						notFound,
					);
					expect(yield* runChanges([move], command("move"))).toEqual([eventId]);
					const current = yield* repository.getEventSnapshot({ userId, eventId });
					assert(current);
					const { snapshot } = current;
					expect(current).toMatchObject({
						revision: 1,
						snapshot: {
							updatedAt: now,
							entityId: movedId,
							sessionEntityId: movedId,
							properties: { rating: 3 },
							createdAt: created.createdAt,
							occurredAt: beforeTime.toISOString(),
						},
					});
					expect(yield* runChanges([move], command("noop"))).toEqual([]);
					assertExitFails(
						yield* Effect.exit(
							runChanges([eventDelete(eventId)], command("failed-delete"), {
								planner: failingPlanner,
							}),
						),
						new DbError({ message: "planning failed after run insertion" }),
					);
					expect(yield* repository.getEventSnapshot({ userId, eventId })).toEqual(current);
					expect(yield* runChanges([eventDelete(eventId)], command("delete"))).toEqual([eventId]);
					assertExitFails(
						yield* Effect.exit(runChanges([eventDelete(eventId)], command("already-deleted"))),
						notFound,
					);
					const result = yield* Effect.promise(
						(): Promise<{ readonly rows: ReadonlyArray<unknown> }> =>
							observer.query(
								`SELECT payload FROM automation_trigger WHERE category = 'change' AND operation <> 'batch' ORDER BY operation DESC`,
							),
					);
					expect(result.rows).toHaveLength(2);
					const batches = yield* Effect.promise(() =>
						observer.query(
							`SELECT payload->'items'->0->>'operation' AS item, jsonb_array_length(payload->'items')::int AS items FROM automation_trigger WHERE category = 'change' AND operation = 'batch' ORDER BY item`,
						),
					);
					expect(batches.rows).toEqual([
						{ items: 1, item: "delete" },
						{ items: 1, item: "update" },
					]);
					const [updated, deleted] = yield* Schema.decodeUnknownEffect(
						Schema.Array(Schema.Struct({ payload: Schema.Record(Schema.String, Schema.Unknown) })),
					)(result.rows);
					expect(updated?.payload).toMatchObject({
						after: snapshot,
						operation: "update",
						before: { entityId, sessionEntityId: entityId, updatedAt: created.createdAt },
					});
					expect(updated?.payload["after"]).toEqual(snapshot);
					expect(deleted?.payload).toEqual({
						before: snapshot,
						resource: "event",
						category: "change",
						operation: "delete",
					});
				}),
			testTimeout,
		);
	});

	layer(lifecycleDatabaseLayer())("event lifecycle harness", (test) => {
		test.effect(
			"rejects a move or delete whose event changed while its policies ran and writes nothing",
			() =>
				Effect.gen(function* () {
					const { observer } = yield* LifecycleDatabase;
					const session = yield* DatabaseSession;
					const repository = yield* EventsRepository;
					const createdAt = DateTime.toDate(DateTime.makeUnsafe("2025-01-01T00:00:00.000Z"));
					const seed = (id: string) =>
						session.transaction(
							repository.createEvent({
								userId,
								entityId,
								eventSchemaSlug,
								id: EventId.make(id),
								occurredAt: createdAt,
								properties: { rating: 3 },
								eventSchemaPluginId: null,
								propertiesSchema: { fields: {} },
								eventSchemaName: { key: "test.rating", namespace: "kernel" },
							}),
						);
					const changedDuringPolicies = (eventId: EventId) =>
						decidingPolicies(
							() => Effect.succeed([policyFixture(1, deleteTargets)]),
							() =>
								session
									.transaction(
										repository.updateEventEntityReferences({
											userId,
											eventId,
											mergeInto: movedId,
											mergeFrom: entityId,
											updatedAt: DateTime.toDate(DateTime.makeUnsafe("2026-09-15T00:00:01.000Z")),
										}),
									)
									.pipe(Effect.orDie, Effect.as({ action: "allow" as const })),
						);
					const staleId = EventId.make("prepared-stale");
					yield* seed(staleId);
					assertExitFails(
						yield* Effect.exit(
							runChanges(
								[eventMove({ eventId: staleId, mergeInto: movedId, mergeFrom: entityId })],
								command("prepared-stale"),
								{ policies: changedDuringPolicies(staleId) },
							),
						),
						new EventStale({ reason: { eventId: staleId, code: "event-stale" } }),
					);
					const staleDeleteId = EventId.make("prepared-stale-delete");
					yield* seed(staleDeleteId);
					assertExitFails(
						yield* Effect.exit(
							runChanges([eventDelete(staleDeleteId)], command("prepared-stale-delete"), {
								policies: changedDuringPolicies(staleDeleteId),
							}),
						),
						new EventStale({ reason: { code: "event-stale", eventId: staleDeleteId } }),
					);
					expect(
						yield* repository.getEventSnapshot({ userId, eventId: staleDeleteId }),
					).not.toBeNull();
					const unchanged = yield* Effect.promise(() =>
						observer.query(
							`select (select count(*)::int from automation_trigger where category = 'change') as changes, (select count(*)::int from automation_run) as runs`,
						),
					);
					expect(unchanged.rows).toEqual([{ runs: 0, changes: 0 }]);

					const rejectedId = EventId.make("prepared-rejected");
					yield* seed(rejectedId);
					const rejected = yield* runChanges(
						[eventDelete(rejectedId)],
						command("prepared-rejected"),
						{
							policies: decidingPolicies(
								() => Effect.succeed([policyFixture(1, deleteTargets)]),
								() =>
									Effect.gen(function* () {
										expect(!(yield* session.isTransactionActive)).toBe(true);
										return { action: "reject" as const, reason: { key: "rejection.rejected" } };
									}),
							),
						},
					).pipe(Effect.flip);
					expect(rejected).toMatchObject({
						_tag: "EventBadRequest",
						reason: {
							code: "policy-rejected",
							message: { key: "rejection.rejected", namespace: "policy-plugin" },
						},
					});
					expect(
						yield* repository.getEventSnapshot({ userId, eventId: rejectedId }),
					).not.toBeNull();
				}),
			testTimeout,
		);

		test.effect(
			"reports the stale event of a delete batch",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const repository = yield* EventsRepository;
					const policyCalls = yield* Ref.make(0);
					const eventIds = [EventId.make("batch-fresh"), EventId.make("batch-stale")];
					for (const eventId of eventIds) {
						yield* session.transaction(
							repository.createEvent({
								userId,
								entityId,
								id: eventId,
								eventSchemaSlug,
								properties: { rating: 3 },
								eventSchemaPluginId: null,
								propertiesSchema: { fields: {} },
								occurredAt: DateTime.toDate(DateTime.makeUnsafe(now)),
								eventSchemaName: { key: "test.rating", namespace: "kernel" },
							}),
						);
					}
					const racingPolicies = decidingPolicies(
						() => Effect.succeed([policyFixture(1, deleteTargets)]),
						() =>
							Effect.gen(function* () {
								if ((yield* Ref.updateAndGet(policyCalls, (calls) => calls + 1)) === 2) {
									yield* session
										.transaction(
											repository.updateEventEntityReferences({
												userId,
												mergeInto: movedId,
												mergeFrom: entityId,
												eventId: EventId.make("batch-stale"),
												updatedAt: DateTime.toDate(DateTime.makeUnsafe(now)),
											}),
										)
										.pipe(Effect.orDie);
								}
								return { action: "allow" as const };
							}),
					);
					expect(
						yield* runChanges(
							eventIds.map((eventId) => eventDelete(eventId)),
							command("stale-delete-batch"),
							{ policies: racingPolicies },
						).pipe(Effect.flip),
					).toMatchObject({
						_tag: "EventStale",
						reason: { code: "event-stale", eventId: "batch-stale" },
					});
					for (const eventId of eventIds) {
						expect(yield* repository.getEventSnapshot({ userId, eventId })).not.toBeNull();
					}
				}),
			testTimeout,
		);
	});

	const referenceRaceInputs: Array<PolicyCall> = [];
	layer(
		lifecycleDatabaseLayer(false, {
			policyCount: 1,
			changeEntityPropertiesDuringPolicy: (call) => call !== 2,
			decidePolicy: (input) => {
				referenceRaceInputs.push(input);
				return Effect.succeed({
					action: "transform",
					patch: { resource: "event", draft: { occurredAt: "2026-09-17T00:00:00.000Z" } },
				});
			},
		}),
	)("event lifecycle harness", (test) => {
		test.effect(
			"retries a field-scoped event edit after its reference changes during policies",
			() =>
				Effect.gen(function* () {
					referenceRaceInputs.length = 0;
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const retriedId = EventId.make("reference-race-retried");
					const protectedId = EventId.make("reference-race-protected");
					for (const eventId of [retriedId, protectedId]) {
						yield* session.transaction(
							repository.createEvent({
								userId,
								entityId,
								id: eventId,
								eventSchemaSlug,
								properties: { rating: 1 },
								eventSchemaPluginId: null,
								propertiesSchema: { fields: {} },
								occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
								eventSchemaName: { key: "test.rating", namespace: "kernel" },
							}),
						);
					}
					const rating = { properties: { remove: [], set: { rating: 2 } } };
					expect(
						yield* runChanges(
							[
								eventUpdate({
									...updateItem(retriedId, rating),
									expected: {
										entityId,
										occurredAt: now,
										absentProperties: [],
										sessionEntityId: null,
										kind: "fields" as const,
										properties: { rating: 1 },
									},
								}),
							],
							command("reference-race-retried"),
						),
					).toEqual([retriedId]);
					expect(referenceRaceInputs).toHaveLength(2);
					expect(
						(yield* repository.getEventSnapshot({ userId, eventId: retriedId }))?.snapshot,
					).toMatchObject({ properties: { rating: 2 }, occurredAt: "2026-09-17T00:00:00.000Z" });
					assertExitFails(
						yield* Effect.exit(
							runChanges(
								[eventUpdate(updateItem(protectedId, rating))],
								command("reference-race-protected"),
							),
						),
						new EventStale({ reason: { code: "event-stale", eventId: protectedId } }),
					);
					expect(referenceRaceInputs).toHaveLength(3);
					expect(
						(yield* repository.getEventSnapshot({ userId, eventId: protectedId }))?.snapshot,
					).toMatchObject({ occurredAt: now, properties: { rating: 1 } });
				}),
			testTimeout,
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))(
		"event lifecycle harness",
		(test) => {
			test.effect(
				"creates a no-policy event in one transaction",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const transactionCount = yield* Ref.make(0);
						const measuredSession = DatabaseSession.of({
							...session,
							transaction: (work) =>
								Ref.update(transactionCount, (value) => value + 1).pipe(
									Effect.andThen(session.transaction(work)),
								),
						});
						const repository = yield* EventsRepository.make.pipe(
							Effect.provideServiceEffect(DefinitionCatalog, DefinitionCatalog.make),
							Effect.provideService(DatabaseSession, measuredSession),
						);
						const noHooks = yield* Layer.build(
							planner(yield* Ref.make(false), true, yield* Ref.make<ReadonlyArray<string>>([])),
						).pipe(Effect.provideService(DatabaseSession, measuredSession));
						const input = {
							userId,
							command: command("source-operation-fixture"),
							payload: [{ entityId, eventSchemaSlug, properties: { rating: 1 } }],
						};
						const result = yield* runCreate(input, { repository }).pipe(
							Effect.provide(noHooks),
							Effect.provideService(DatabaseSession, measuredSession),
						);
						expect(result.failure).toBeNull();
						expect(result.count).toBe(1);
						expect(yield* Ref.get(transactionCount)).toBe(1);
					}),
				testTimeout,
			);
		},
	);

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))(
		"event lifecycle harness",
		(test) => {
			test.effect(
				"creates a no-policy event in one transaction",
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const created = yield* runCreate({
							userId,
							command: command("direct-http-create"),
							payload: [{ entityId, eventSchemaSlug, properties: { rating: 4 } }],
						});
						expect(created).toMatchObject({ count: 1, failure: null });
						expect(yield* session.run((db) => db.select().from(tables.event))).toHaveLength(1);
					}),
				testTimeout,
			);
		},
	);

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))(
		"event lifecycle harness",
		(test) => {
			test.effect(
				"records an imported event item in its write",
				() =>
					Effect.gen(function* () {
						const importRunId = ImportRunId.make("imported-event-run");
						yield* (yield* DatabaseSession).run((db) =>
							db
								.insert(tables.importRun)
								.values({ userId, id: importRunId, source: "fixture" })
								.onConflictDoNothing(),
						);
						const base = command("imported-event-item");
						const lifecycle = { ...base, causation: { ...base.causation, importRunId } };
						const result = yield* runCreate({
							userId,
							command: lifecycle,
							itemIdentities: [lifecycle.itemIdentity],
							payload: [{ entityId, eventSchemaSlug, properties: { rating: 2 } }],
						});
						expect(result.count).toBe(1);
						const committed = yield* (yield* IdempotencyKeys.make).importItems({
							userId,
							runId: importRunId,
							itemIdentities: [lifecycle.itemIdentity],
						});
						expect(committed).toEqual([
							{ result: "created", itemIdentity: lifecycle.itemIdentity },
						]);
					}),
				testTimeout,
			);
		},
	);

	layer(lifecycleDatabaseLayer(true))("event lifecycle harness", (test) => {
		test.effect(
			"commits no-hook updates and deletes in one transaction",
			() =>
				Effect.gen(function* () {
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const fixture = yield* LifecycleDatabase;
					const eventId = EventId.make("no-hook-event");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: eventId,
							properties: {},
							eventSchemaSlug,
							eventSchemaPluginId: null,
							propertiesSchema: { fields: {} },
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					const move = { userId, eventId, mergeInto: movedId, mergeFrom: entityId };
					const updated = yield* runChanges([eventMove(move)], command("no-hook-update"));
					expect(updated).toEqual([eventId]);
					expect((yield* repository.getEventSnapshot({ userId, eventId }))?.snapshot.entityId).toBe(
						movedId,
					);
					const noop = yield* runChanges([eventMove(move)], command("no-hook-noop"));
					expect(noop).toEqual([]);
					yield* session.transaction(
						repository.updateEventEntityReferences({
							...move,
							mergeFrom: movedId,
							mergeInto: entityId,
							updatedAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
						}),
					);
					expect((yield* repository.getEventSnapshot({ userId, eventId }))?.snapshot.entityId).toBe(
						entityId,
					);
					expect(yield* runChanges([eventDelete(eventId)], command("no-hook-delete"))).toEqual([
						eventId,
					]);
					const missingId = EventId.make("no-hook-missing-delete");
					assertExitFails(
						yield* Effect.exit(
							runChanges([eventDelete(missingId)], command("no-hook-missing-delete")),
						),
						new EventNotFound({ reason: { eventId: missingId, code: "event-not-found" } }),
					);
					expect(yield* session.run((db) => db.select().from(tables.event))).toHaveLength(0);
					expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
						[],
					);
					const transactions = yield* fixture.planTransactions;
					expect(transactions).toHaveLength(4);
					expect(transactions[0]).toBe(transactions[1]);
					expect(transactions[2]).toBe(transactions[3]);
				}),
			testTimeout,
		);
	});

	const policyInputs: Array<PolicyCall> = [];
	layer(
		lifecycleDatabaseLayer(false, {
			policyCount: 2,
			decidePolicy: (input) => {
				policyInputs.push(input);
				return Effect.succeed(
					policyInputs.length === 1
						? {
								action: "transform",
								patch: {
									resource: "event",
									draft: {
										occurredAt: "2026-09-16T00:00:00.000Z",
										properties: { remove: [], set: { rating: 10 } },
									},
								},
							}
						: { action: "allow" },
				);
			},
		}),
	)("event lifecycle harness", (test) => {
		test.effect(
			"applies event policy transforms in order",
			() =>
				Effect.gen(function* () {
					policyInputs.length = 0;
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const eventId = EventId.make("policy-edit-event");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: eventId,
							eventSchemaSlug,
							properties: { rating: 1 },
							eventSchemaPluginId: null,
							propertiesSchema: { fields: {} },
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					const submitted = updateItem("policy-edit-event", {
						properties: { remove: [], set: { rating: 2 } },
					});
					expect(yield* runChanges([eventUpdate(submitted)], command("policy-edit"))).toEqual([
						eventId,
					]);
					expect(policyInputs).toHaveLength(2);
					expect(policyInputs[1]?.request).toMatchObject({
						draft: { properties: { rating: 10 }, occurredAt: "2026-09-16T00:00:00.000Z" },
					});
					expect(
						(yield* repository.getEventSnapshot({ userId, eventId }))?.snapshot.properties,
					).toEqual({ rating: 10 });
					const moveEventId = EventId.make("policy-move-event");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: moveEventId,
							eventSchemaSlug,
							properties: { rating: 1 },
							eventSchemaPluginId: null,
							propertiesSchema: { fields: {} },
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					policyInputs.length = 0;
					const move = eventMove({ mergeInto: movedId, mergeFrom: entityId, eventId: moveEventId });
					expect(yield* runChanges([move], command("policy-move"))).toEqual([moveEventId]);
					expect(policyInputs[1]?.request).toMatchObject({
						draft: { properties: { rating: 10 }, occurredAt: "2026-09-16T00:00:00.000Z" },
					});
					const moved = yield* repository.getEventSnapshot({ userId, eventId: moveEventId });
					expect(moved?.snapshot).toMatchObject({
						entityId: movedId,
						properties: { rating: 10 },
						occurredAt: "2026-09-16T00:00:00.000Z",
					});
				}),
			testTimeout,
		);
	});

	layer(lifecycleDatabaseLayer(true))("event lifecycle harness", (test) => {
		test.effect(
			"rejects invalid event properties and unreadable references",
			() =>
				Effect.gen(function* () {
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const eventId = EventId.make("invalid-edit-event");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: eventId,
							eventSchemaSlug,
							properties: { rating: 1 },
							eventSchemaPluginId: null,
							propertiesSchema: { fields: {} },
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					assertExitFails(
						yield* Effect.exit(
							runChanges(
								[
									eventUpdate(
										updateItem("invalid-edit-event", {
											properties: { remove: [], set: { rating: "invalid" } },
										}),
									),
								],
								command("invalid-edit-properties"),
							),
						),
						new EventBadRequest({ reason: { code: "invalid-properties" } }),
					);
					const unreadable = EntityId.make("unreadable");
					assertExitFails(
						yield* Effect.exit(
							runChanges(
								[eventUpdate(updateItem("invalid-edit-event", { entityId: unreadable }))],
								command("unreadable-edit-reference"),
							),
						),
						new EventCreateItemError({
							reason: { entityId: unreadable, code: "entity-not-found" },
						}),
					);
					expect(
						(yield* repository.getEventSnapshot({ userId, eventId }))?.snapshot.properties,
					).toEqual({ rating: 1 });
				}),
			testTimeout,
		);
	});

	layer(lifecycleDatabaseLayer(true))("event lifecycle harness", (test) => {
		test.effect(
			"matches field-scoped preconditions for event updates and deletes",
			() =>
				Effect.gen(function* () {
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const fixture = yield* LifecycleDatabase;
					const eventId = EventId.make("field-precondition-edit");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: eventId,
							eventSchemaSlug,
							eventSchemaPluginId: null,
							propertiesSchema: { fields: {} },
							properties: { rating: 1, note: "before" },
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					const expected = {
						entityId,
						occurredAt: now,
						sessionEntityId: null,
						kind: "fields" as const,
						properties: { rating: 1 },
						absentProperties: ["missing"],
					};
					yield* Effect.promise(() =>
						fixture.observer.query(
							'UPDATE event SET properties = \'{"note":"after","rating":1}\'::jsonb, updated_at = $2 WHERE id = $1',
							[eventId, "2026-09-16T00:00:00.000Z"],
						),
					);
					const changed = yield* repository.getEventSnapshot({ userId, eventId });
					assert(changed);
					expect(changed.snapshot.updatedAt).not.toBe(now);
					expect(changed.snapshot.properties).toEqual({ rating: 1, note: "after" });
					expect(
						yield* runChanges(
							[
								eventUpdate({
									...updateItem(eventId, { properties: { remove: [], set: { rating: 2 } } }),
									expected,
								}),
							],
							command("field-precondition-edit"),
						),
					).toEqual([eventId]);

					const staleId = EventId.make("field-precondition-stale");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: staleId,
							eventSchemaSlug,
							properties: { rating: 2 },
							eventSchemaPluginId: null,
							propertiesSchema: { fields: {} },
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					const rejectsEdit = (precondition: UpdateEventItem["expected"], commandId: string) =>
						runChanges(
							[
								eventUpdate({
									...updateItem(staleId, { properties: { remove: [], set: { rating: 3 } } }),
									expected: precondition,
								}),
							],
							command(commandId),
						);
					const matchingStaleExpected = { ...expected, properties: { rating: 2 } };
					for (const [index, mismatch] of [
						{ ...matchingStaleExpected, properties: { rating: 1 } },
						{ ...matchingStaleExpected, properties: { note: null } },
						{ ...matchingStaleExpected, entityId: movedId },
						{ ...matchingStaleExpected, occurredAt: "2026-09-16T00:00:00.000Z" },
						{ ...matchingStaleExpected, sessionEntityId: movedId },
					].entries()) {
						const stale = yield* Effect.flip(
							rejectsEdit(mismatch, `field-precondition-stale-${index}`),
						);
						expect(stale).toBeInstanceOf(EventStale);
					}

					const deleteId = EventId.make("field-precondition-delete");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: deleteId,
							eventSchemaSlug,
							properties: { rating: 1 },
							eventSchemaPluginId: null,
							propertiesSchema: { fields: {} },
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					expect(
						yield* runChanges(
							[eventDelete(deleteId, { ...expected, absentProperties: [] })],
							command("field-precondition-delete"),
						),
					).toEqual([deleteId]);
				}),
			testTimeout,
		);
	});

	layer(lifecycleDatabaseLayer(true))("event lifecycle harness", (test) => {
		test.effect(
			"rejects a stale event revision when updatedAt is unchanged",
			() =>
				Effect.gen(function* () {
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const eventId = EventId.make("stale-edit-event");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: eventId,
							eventSchemaSlug,
							properties: { rating: 1 },
							eventSchemaPluginId: null,
							propertiesSchema: { fields: {} },
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
							eventSchemaName: { key: "test.rating", namespace: "kernel" },
						}),
					);
					const before = yield* repository.getEventSnapshot({ userId, eventId });
					assert(before);
					const movingPolicies = decidingPolicies(
						() => Effect.succeed([policyFixture(0, [])]),
						() =>
							session
								.transaction(
									repository.updateEventEntityReferences({
										userId,
										eventId,
										mergeInto: movedId,
										mergeFrom: entityId,
										updatedAt: DateTime.toDateUtc(DateTime.makeUnsafe(before.snapshot.updatedAt)),
									}),
								)
								.pipe(Effect.orDie, Effect.as({ action: "allow" as const })),
					);
					assertExitFails(
						yield* Effect.exit(
							runChanges(
								[
									eventUpdate(
										updateItem("stale-edit-event", {
											properties: { remove: [], set: { rating: 2 } },
										}),
									),
								],
								command("stale-edit"),
								{ policies: movingPolicies },
							),
						),
						new EventStale({ reason: { eventId, code: "event-stale" } }),
					);
					const after = yield* repository.getEventSnapshot({ userId, eventId });
					assert(after);
					expect(after.snapshot.updatedAt).toBe(before.snapshot.updatedAt);
					expect(after.revision).toBe(before.revision + 1);
					expect(after.snapshot).toMatchObject({ entityId: movedId, properties: { rating: 1 } });
				}),
			testTimeout,
		);
	});

	const retryPolicyInputs: Array<PolicyCall> = [];
	const retryEventId = EventId.make("field-precondition-retry");
	const protectedEventId = EventId.make("field-precondition-protected");
	layer(
		lifecycleDatabaseLayer(false, {
			policyCount: 1,
			decidePolicy: (input, { session, repository }) =>
				Effect.gen(function* () {
					retryPolicyInputs.push(input);
					if (retryPolicyInputs.length === 1) {
						yield* updateEventProperties(repository, session, retryEventId, (properties) => ({
							...properties,
							note: "policy-derived",
						}));
					} else if (retryPolicyInputs.length === 3) {
						yield* updateEventProperties(repository, session, protectedEventId, (properties) => ({
							...properties,
							rating: 99,
						}));
					}
					return { action: "allow" } as const;
				}).pipe(Effect.orDie),
		}),
	)("event lifecycle harness", (test) => {
		test.effect(
			"reprepares field-scoped event edits after ignored state changes",
			() =>
				Effect.gen(function* () {
					retryPolicyInputs.length = 0;
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					for (const [eventId, note] of [
						[retryEventId, "before"],
						[protectedEventId, "protected"],
					] as const) {
						yield* session.transaction(
							repository.createEvent({
								userId,
								entityId,
								id: eventId,
								eventSchemaSlug,
								eventSchemaPluginId: null,
								properties: { note, rating: 1 },
								propertiesSchema: { fields: {} },
								occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
								eventSchemaName: { key: "test.rating", namespace: "kernel" },
							}),
						);
					}
					const expected = {
						entityId,
						occurredAt: now,
						sessionEntityId: null,
						kind: "fields" as const,
						properties: { rating: 1 },
						absentProperties: ["missing"],
					};
					expect(
						yield* runChanges(
							[
								eventUpdate({
									...updateItem(retryEventId, { properties: { remove: [], set: { rating: 2 } } }),
									expected,
								}),
							],
							command("field-precondition-retry"),
						),
					).toEqual([retryEventId]);
					expect(retryPolicyInputs).toHaveLength(2);
					const retryResult = yield* repository.getEventSnapshot({ userId, eventId: retryEventId });
					assert(retryResult);
					expect(retryResult.snapshot.properties).toEqual({ rating: 2, note: "policy-derived" });
					expect(retryResult.revision).toBe(2);
					expect(
						retryPolicyInputs.map(({ request }) =>
							request.operation === "update" ? request.before.properties["note"] : null,
						),
					).toEqual(["before", "policy-derived"]);

					assertExitFails(
						yield* Effect.exit(
							runChanges(
								[
									eventUpdate({
										...updateItem(protectedEventId, {
											properties: { remove: [], set: { rating: 2 } },
										}),
										expected,
									}),
								],
								command("field-precondition-protected"),
							),
						),
						new EventStale({ reason: { code: "event-stale", eventId: protectedEventId } }),
					);
					expect(retryPolicyInputs).toHaveLength(3);
					const protectedResult = yield* repository.getEventSnapshot({
						userId,
						eventId: protectedEventId,
					});
					assert(protectedResult);
					expect(protectedResult.snapshot.properties).toEqual({ rating: 99, note: "protected" });
					expect(protectedResult.revision).toBe(1);
				}),
			testTimeout,
		);
	});

	layer(lifecycleDatabaseLayer())("event lifecycle harness", (test) => {
		test.effect(
			"rolls back every event in a failed atomic update batch",
			() =>
				Effect.gen(function* () {
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const fixture = yield* LifecycleDatabase;
					const eventIds = [EventId.make("atomic-edit-first"), EventId.make("atomic-edit-second")];
					for (const eventId of eventIds) {
						yield* session.transaction(
							repository.createEvent({
								userId,
								entityId,
								id: eventId,
								eventSchemaSlug,
								properties: { rating: 1 },
								eventSchemaPluginId: null,
								propertiesSchema: { fields: {} },
								occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
								eventSchemaName: { key: "test.rating", namespace: "kernel" },
							}),
						);
					}
					yield* fixture.failChangePlanning(true);
					assertExitFails(
						yield* Effect.exit(
							runChanges(
								eventIds.map((eventId, index) =>
									eventUpdate(
										updateItem(eventId, { properties: { remove: [], set: { rating: index + 2 } } }),
									),
								),
								command("atomic-event-edit"),
							),
						),
						new DbError({ message: "planning failed after run insertion" }),
					);
					for (const eventId of eventIds) {
						expect(
							(yield* repository.getEventSnapshot({ userId, eventId }))?.snapshot.properties,
						).toEqual({ rating: 1 });
					}
				}),
			testTimeout,
		);
	});

	layer(Layer.provideMerge(lifecycleDatabaseLayer(true), BunCrypto.layerSecureRandom))(
		"event lifecycle harness",
		(test) => {
			test.effect(
				"rejects an event edit that references another user's managed asset",
				() =>
					Effect.gen(function* () {
						const repository = yield* EventsRepository;
						const session = yield* DatabaseSession;
						const foreign = yield* insertManagedAsset(UserId.make("event-asset-foreign"));
						const eventId = EventId.make("foreign-asset-edit-event");
						yield* session.transaction(
							repository.createEvent({
								userId,
								entityId,
								id: eventId,
								eventSchemaSlug,
								properties: { rating: 1 },
								eventSchemaPluginId: null,
								propertiesSchema: { fields: {} },
								occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
								eventSchemaName: { key: "test.rating", namespace: "kernel" },
							}),
						);
						assertExitFails(
							yield* Effect.exit(
								runChanges(
									[
										eventUpdate(
											updateItem("foreign-asset-edit-event", {
												properties: { remove: [], set: { image: foreign } },
											}),
										),
									],
									command("foreign-asset-edit"),
								),
							),
							new EventBadRequest({ reason: { code: "asset-forbidden" } }),
						);
						expect(
							(yield* repository.getEventSnapshot({ userId, eventId }))?.snapshot.properties,
						).toEqual({ rating: 1 });
					}),
				testTimeout,
			);
		},
	);

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))(
		"event lifecycle harness",
		(test) => {
			test.effect(
				"orders a command's events by submission across workflow chunks",
				() =>
					Effect.gen(function* () {
						const { observer } = yield* LifecycleDatabase;
						const created = yield* createRatings("ordered-events", 120);
						expect(created.count).toBe(120);
						const { rows } = yield* Effect.promise(() =>
							observer.query<{ id: string; rating: number }>(
								`SELECT id, (properties->>'rating')::int AS rating FROM event ORDER BY occurred_at DESC, created_at DESC, id DESC`,
							),
						);
						expect(rows.map(({ rating }) => rating)).toEqual(
							Array.from({ length: 120 }, (_, index) => 119 - index),
						);
						expect(rows[0]?.id).toMatch(/^event_003b_/);
						expect(rows[119]?.id).toMatch(/^event_0000_/);
						const replayed = yield* createRatings("ordered-events", 120);
						expect(replayed.count).toBe(120);
						const after = yield* Effect.promise(() =>
							observer.query<{ id: string }>(
								`SELECT id FROM event ORDER BY occurred_at DESC, created_at DESC, id DESC`,
							),
						);
						expect(after.rows.map(({ id }) => id)).toEqual(rows.map(({ id }) => id));
					}),
				testTimeout,
			);
		},
	);

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))(
		"event lifecycle harness",
		(test) => {
			test.effect(
				"sorts a later command after an earlier one and leaves single events unchanged",
				() =>
					Effect.gen(function* () {
						const { observer } = yield* LifecycleDatabase;
						yield* createRatings("ordered-first", 3);
						yield* TestClock.adjust("1 millis");
						yield* createRatings("ordered-second", 3);
						yield* TestClock.adjust("1 millis");
						yield* createRatings("ordered-single", 1);
						const { rows } = yield* Effect.promise(() =>
							observer.query<{ id: string; rating: number }>(
								`SELECT id, (properties->>'rating')::int AS rating FROM event ORDER BY occurred_at DESC, created_at DESC, id DESC`,
							),
						);
						expect(rows.map(({ rating }) => rating)).toEqual([0, 2, 1, 0, 2, 1, 0]);
						expect(rows[0]?.id).toMatch(/^event_0000_/);
					}),
				testTimeout,
			);
		},
	);
});
