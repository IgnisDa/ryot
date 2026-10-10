import { assert, describe, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import { EventStale, type UpdateEventItem } from "@ryot-app/contract/modules/events/schemas";
import {
	AutomationExecutionId,
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { and, eq, sql } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Redacted, Ref, Schema, Scope } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";
import { Client } from "pg";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import {
	makeAppConfigLayer,
	makeConfigProviderLayer,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import { ingestionRetirementTestLayer } from "#lib/test-utils/ingestion-retirement";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { AuthService } from "#modules/auth/service";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";
import { ImportsRepository } from "#modules/imports/repository";
import { MutationReceipts, MutationReceiptIdentity } from "#modules/mutations/receipts";
import { AdmittedWorkflowCatalogue } from "#modules/mutations/workflow-catalogue";
import { ObjectStorageService } from "#modules/uploads/object-storage/service";
import { UserLifecycleRepository } from "#modules/user-lifecycle/repository";
import { UserLifecycleService } from "#modules/user-lifecycle/service";
import {
	runUserLifecycleWorkflow,
	UserLifecycleWorkflow,
	UserLifecycleWorkflowOperations,
	UserLifecycleWorkflowOperationsLive,
} from "#modules/user-lifecycle/workflow";

import { EventCreateWorkflow, EventCreateWorkflowPayload } from "./event-create-workflow";
import { runEventCreateWorkflow } from "./event-create-workflow-live";
import { eventCreateBatchInput } from "./mutation-receipts";
import { EventsRepository } from "./repository";
import { EventsService } from "./service";

const userId = UserId.make("event-owner");
const entityId = EntityId.make("event-subject");
const movedId = EntityId.make("event-moved-subject");
const eventSchemaSlug = EventSchemaSlug.make("rating");
const now = "2026-09-15T00:00:00.000Z";
const editPropertiesSchema = {
	fields: { rating: { type: "number", label: "Rating", description: "Rating" } },
} as const;
const command = (id: string) =>
	rootLifecycleCommand({
		source: "api",
		occurredAt: now,
		lane: "interactive",
		itemIdentity: "event",
		initiator: { id: userId, kind: "user" },
		executionId: AutomationExecutionId.make(id),
		accountGeneration: { userId, token: "test-account-generation" },
	});
const updateItem = (id: string, patch: UpdateEventItem["patch"]): UpdateEventItem => ({
	patch,
	eventId: EventId.make(id),
});

class LifecycleDatabase extends Context.Service<
	LifecycleDatabase,
	{
		readonly observer: Client;
		readonly url: string;
		readonly failChangePlanning: (fail: boolean) => Effect.Effect<void>;
		readonly planTransactions: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/LifecycleDatabase") {}

const isolatedDatabase = Effect.gen(function* () {
	const { url } = yield* IsolatedDatabase;
	const observer = yield* Effect.acquireRelease(
		Effect.gen(function* () {
			const client = new Client({ connectionString: url });
			yield* Effect.tryPromise(() => client.connect());
			return client;
		}),
		(client) => Effect.promise(() => client.end()),
	);
	yield* Effect.tryPromise(() =>
		observer.query(
			`INSERT INTO "user" (id,name,email,account_generation) VALUES ($1,'Owner','event@example.test','test-account-generation');`,
			[userId],
		),
	);
	yield* Effect.tryPromise(() =>
		observer.query(
			`INSERT INTO entity (id,name,entity_schema_slug,properties) VALUES ($1,'Subject','record','{}'),($2,'Moved','record','{}')`,
			[entityId, movedId],
		),
	);
	yield* Effect.tryPromise(() =>
		observer.query(
			`INSERT INTO sandbox_script (id,slug,name,source,content_hash,compiled_code,metadata) VALUES ('script','fixture','Fixture','','hash','','{}')`,
		),
	);
	return { url, observer };
});

const planner = (
	failChange: Ref.Ref<boolean>,
	noHooks: boolean,
	transactions: Ref.Ref<ReadonlyArray<string>>,
	policyCount: number,
) =>
	Layer.effect(
		LifecyclePlanner,
		Effect.map(DatabaseSession, (session) =>
			withLifecycleBatchPlanning(
				{
					plan: ({ trigger }) =>
						Effect.gen(function* () {
							const [transaction] = yield* session.run((db) =>
								db.execute<{ id: string }>(sql`select txid_current()::text as id`, "objects"),
							);
							if (transaction) {
								yield* Ref.update(transactions, (all) => [...all, transaction.id]);
							}
							if (noHooks) {
								return {
									trigger: null,
									runs: [] as const,
									policies: [] as const,
									_tag: "NoHooks" as const,
									wasCreated: false as const,
								};
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
									}),
							);
							if (kind.category === "change") {
								yield* session.run((db) =>
									db
										.insert(tables.automationRun)
										.values({
											stage: "after",
											delivery: "async",
											hookSlug: "fixture",
											hookName: "Fixture",
											triggerId: trigger.id,
											scriptSlug: "fixture",
											id: `run-${trigger.id}`,
											sandboxScriptId: "script",
											scriptContentHash: "hash",
											retryPolicy: DEFAULT_AUTOMATION_RETRY_POLICY,
											artifactsExpireAt: DateTime.toDate(DateTime.makeUnsafe(now)),
										}),
								);
								if (yield* Ref.get(failChange)) {
									return yield* new DbError({ message: "planning failed after run insertion" });
								}
							}
							return {
								trigger,
								runs: [],
								wasCreated: true,
								policies:
									kind.category === "request" && kind.operation === "update"
										? Array.from({ length: policyCount }, (_, index) => ({
												position: index,
												runId: AutomationRunId.make(`event-policy-${index}`),
											}))
										: [],
							};
						}),
				},
				200,
				!noHooks,
			),
		),
	);

const workflowLayer = Layer.mergeAll(
	Layer.mock(EntitiesRepository)({
		lockEntityReferencesByIds: () => Effect.void,
		getByIdForUser: ({ entityId: requestedId }) =>
			Effect.succeed({
				createdAt: now,
				updatedAt: now,
				properties: {},
				id: requestedId,
				name: "Subject",
				externalId: null,
				providerId: null,
				populatedAt: null,
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			}),
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
	Layer.mock(EventSchemasRepository)({
		lockCatalog: () => Effect.void,
		getScopeForUser: () =>
			Effect.succeed({
				slug: "rating",
				name: "Rating",
				id: eventSchemaSlug,
				propertiesSchema: { fields: {} },
				entitySchemaSlug: EntitySchemaSlug.make("record"),
			}),
	}),
);
const engine = makeWorkflowEngine({
	activityExecute: (activity) =>
		Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
});
const lifecycleDatabaseLayer = (
	noHooks = false,
	options: {
		policyCount?: number;
		changeEntityPropertiesDuringPolicy?: boolean;
		executePolicy?: LifecycleExecution["Service"]["executePolicy"];
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const database = yield* isolatedDatabase;
			const failChange = yield* Ref.make(false);
			const entityProperties = yield* Ref.make({ context: "stable" });
			const planTransactions = yield* Ref.make<ReadonlyArray<string>>([]);
			const config = makeAppConfigLayer({ database: { url: Redacted.make(database.url) } });
			const databaseSession = DatabaseSession.layer;
			const entitySchemaSlug = EntitySchemaSlug.make("record");
			const entityReference = (requestedId: EntityId) => ({
				isBuiltin: true,
				entitySchemaSlug,
				entityUserId: userId,
				entityId: requestedId,
				entityName: "Subject",
				entitySchemaPluginId: null,
			});
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
			});
			return EventsService.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						EventsRepository.layer.pipe(Layer.provideMerge(databaseSession)),
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
						}),
						Layer.mock(EventSchemasRepository)({
							lockCatalog: () => Effect.void,
							getScopeForUser: (input) =>
								Effect.succeed(
									input.eventSchemaSlug === eventSchemaSlug &&
										input.entitySchemaSlug === entitySchemaSlug
										? {
												name: "Rating",
												entitySchemaSlug,
												id: eventSchemaSlug,
												slug: eventSchemaSlug,
												propertiesSchema: editPropertiesSchema,
											}
										: null,
								),
						}),
						ImportsRepository.layer.pipe(Layer.provideMerge(databaseSession)),
						planner(failChange, noHooks, planTransactions, options.policyCount ?? 0).pipe(
							Layer.provide(databaseSession),
						),
						Layer.succeed(
							LifecycleExecution,
							withLifecycleDispatch({
								after: () => Effect.succeed([]),
								skipQueuedPolicies: () => Effect.void,
								executePolicy: (input) =>
									(options.executePolicy ?? (() => Effect.die("Unexpected policy")))(input).pipe(
										Effect.tap(() =>
											options.changeEntityPropertiesDuringPolicy
												? Ref.set(entityProperties, { context: "changed" })
												: Effect.void,
										),
									),
							}),
						),
						Layer.succeed(WorkflowEngine, engine),
					),
				),
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

describe("Event lifecycle PostgreSQL", () => {
	layer(Layer.merge(lifecycleDatabaseLayer(), workflowLayer))((test) => {
		test.effect(
			"seals cancelled prefixes and terminal failures but not suspended event batches",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const receipts = yield* MutationReceipts.make;
					const repository = yield* EventsRepository;
					const underlying = yield* LifecyclePlanner;
					const recordingPlanner = LifecyclePlanner.of({
						...underlying,
						planBatch: (input) =>
							Effect.gen(function* () {
								const identity = receipts.batchIdentity({
									...input,
									ownerUserId:
										input.command.causation.initiator.kind === "user"
											? input.command.causation.initiator.id
											: null,
								});
								const planned = yield* underlying.planBatch(input);
								yield* receipts.sealBatch(identity, planned);
								return planned;
							}),
						prepareBatch: (input) => {
							const identity = receipts.batchIdentity({
								...input,
								ownerUserId:
									input.command.causation.initiator.kind === "user"
										? input.command.causation.initiator.id
										: null,
							});
							return receipts.beginBatch({ identity, pins: [], maxItems: 200 }).pipe(
								Effect.mapError((error) =>
									error instanceof DbError
										? error
										: new DbError({ message: "Conflicting batch command" }),
								),
								Effect.map((decision) => ({
									id: identity.id,
									hasCandidates: decision.candidateCount > 0,
								})),
							);
						},
					});
					const batchInput = (id: string, system = false) => {
						const lifecycle = command(id);
						return {
							userId,
							payload: [
								{ entityId, eventSchemaSlug, properties: { rating: 1 } },
								{ entityId, eventSchemaSlug, properties: { rating: 2 } },
							],
							command: system
								? {
										...lifecycle,
										causation: {
											...lifecycle.causation,
											initiator: { id: null, kind: "system" as const },
										},
									}
								: lifecycle,
						};
					};
					const interrupted = (id: string, explicit: boolean, system = false) =>
						Effect.gen(function* () {
							const input = batchInput(id, system);
							const instance = WorkflowInstance.initial(EventCreateWorkflow.interactive, id);
							const exit = yield* runEventCreateWorkflow(input, id).pipe(
								Effect.provideService(WorkflowInstance, instance),
								Effect.provideService(WorkflowEngine, engine),
								Effect.provideService(LifecyclePlanner, recordingPlanner),
								Effect.provideService(
									LifecycleExecution,
									withLifecycleDispatch({
										after: () => Effect.interrupt,
										skipQueuedPolicies: () => Effect.void,
										executePolicy: () => Effect.die("Unexpected policy"),
									}),
								),
								Effect.exit,
							);
							instance.interrupted = explicit;
							instance.suspended = !explicit;
							instance.abandoned = !explicit;
							yield* Scope.close(instance.scope, exit);
							const decision = receipts.batchIdentity({
								...eventCreateBatchInput(input),
								ownerUserId: system ? null : userId,
							});
							return yield* session.transaction(receipts.lookupBatch(decision));
						});
					const suspended = yield* interrupted("event-suspension-prefix", false);
					expect(suspended?.sealed).toBe(false);
					const resumed = yield* runEventCreateWorkflow(
						batchInput("event-suspension-prefix"),
						"event-suspension-prefix",
					).pipe(
						Effect.provideService(
							WorkflowInstance,
							WorkflowInstance.initial(EventCreateWorkflow.interactive, "event-suspension-prefix"),
						),
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(LifecyclePlanner, recordingPlanner),
					);
					expect(resumed.count).toBe(2);
					const resumedBatch = yield* session.run((db) =>
						db
							.select()
							.from(tables.automationTrigger)
							.where(
								sql`${tables.automationTrigger.executionId} = ${"event-suspension-prefix"} and ${tables.automationTrigger.operation} = 'batch'`,
							),
					);
					expect(resumedBatch[0]?.payload).toMatchObject({ items: [{}, {}] });
					const cancelled = yield* interrupted("event-cancelled-prefix", true);
					expect(cancelled?.sealed).toBe(true);
					expect(cancelled?.dispatch).toHaveLength(1);
					const systemCancelled = yield* interrupted("system-event-cancelled-prefix", true, true);
					expect(systemCancelled?.sealed).toBe(true);
					expect(systemCancelled?.dispatch).toHaveLength(1);
					const invalid = batchInput("invalid-first-event");
					const invalidInput = {
						...invalid,
						payload: [{ properties: {}, eventSchemaSlug, entityId: EntityId.make(" ") }],
					};
					const emptyDecision = receipts.batchIdentity({
						...eventCreateBatchInput(invalidInput),
						ownerUserId: userId,
					});
					const candidateId = `receipt-candidate-${emptyDecision.id}`;
					yield* session.transaction(
						receipts.beginBatch({
							maxItems: 200,
							identity: emptyDecision,
							pins: [
								{
									pluginId: null,
									id: candidateId,
									sandboxScriptId: null,
									pluginRevisionId: null,
									executionUserId: userId,
									result: { hook: "batch" },
									pluginConfigRevisionId: null,
								},
							],
						}),
					);
					const failed = yield* runEventCreateWorkflow(invalidInput, "invalid-first-event").pipe(
						Effect.provideService(
							WorkflowInstance,
							WorkflowInstance.initial(EventCreateWorkflow.interactive, "invalid-first-event"),
						),
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(LifecyclePlanner, recordingPlanner),
					);
					expect(failed).toMatchObject({ count: 0, failure: { index: 0 } });
					expect((yield* session.transaction(receipts.lookupBatch(emptyDecision)))?.sealed).toBe(
						true,
					);
					expect(
						yield* session.run((db) =>
							db
								.select()
								.from(tables.mutationReceipt)
								.where(sql`${tables.mutationReceipt.id} = ${candidateId}`),
						),
					).toEqual([]);
					expect(
						yield* repository.getCreateProgress(userId, "event-cancelled-prefix"),
					).toMatchObject({ writtenCount: 1 });
					const batch = yield* session.run((db) =>
						db
							.select()
							.from(tables.automationTrigger)
							.where(
								sql`${tables.automationTrigger.executionId} = ${"event-cancelled-prefix"} and ${tables.automationTrigger.operation} = 'batch'`,
							),
					);
					expect(batch).toHaveLength(1);
					expect(batch[0]?.payload).toMatchObject({ items: [{ operation: "create" }] });
					expect(
						yield* session.run((db) =>
							db
								.select({ status: tables.automationRun.status })
								.from(tables.automationRun)
								.where(sql`${tables.automationRun.triggerId} = ${batch[0]?.id}`),
						),
					).toEqual([{ status: "queued" }]);
				}),
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(), workflowLayer))((test) => {
		test.effect(
			"replays committed event delivery after dispatch fails and keeps progress after history removal",
			() =>
				Effect.gen(function* () {
					const { observer } = yield* LifecycleDatabase;
					const repository = yield* EventsRepository;
					let dispatched = 0;
					const triggerIds: string[] = [];
					const payload = {
						userId,
						command: command("event-dispatch-recovery"),
						payload: [{ entityId, properties: {}, eventSchemaSlug }],
					};
					const run = () =>
						runEventCreateWorkflow(payload, payload.command.causation.executionId).pipe(
							Effect.provideService(WorkflowEngine, engine),
							Effect.provideService(
								WorkflowInstance,
								WorkflowInstance.initial(
									EventCreateWorkflow.interactive,
									payload.command.causation.executionId,
								),
							),
							Effect.provideService(
								LifecycleExecution,
								withLifecycleDispatch({
									skipQueuedPolicies: () => Effect.void,
									executePolicy: () => Effect.die("Unexpected policy"),
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
						(yield* repository.getCreateProgress(userId, payload.command.causation.executionId))
							.writtenCount,
					).toBe(1);
					expect(
						(yield* Effect.promise(() =>
							observer.query("SELECT count(*)::int AS count FROM automation_run"),
						)).rows,
					).toEqual([{ count: 1 }]);
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
					expect(
						yield* repository.getCreateProgress(userId, payload.command.causation.executionId),
					).toEqual({ writtenCount: 1, requiredPending: false });
				}),
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(), workflowLayer))((test) => {
		test.effect(
			"event, change trigger and queued runs commit together and roll back together",
			() =>
				Effect.gen(function* () {
					const { observer, failChangePlanning } = yield* LifecycleDatabase;
					const run = (id: string, fail: boolean) => {
						let dispatched = 0;
						return failChangePlanning(fail).pipe(
							Effect.andThen(
								runEventCreateWorkflow(
									{
										userId,
										command: command(id),
										payload: [{ entityId, properties: {}, eventSchemaSlug }],
									},
									id,
								),
							),
							Effect.provideService(WorkflowEngine, engine),
							Effect.provideService(
								WorkflowInstance,
								WorkflowInstance.initial(EventCreateWorkflow.interactive, id),
							),
							Effect.provideService(
								LifecycleExecution,
								withLifecycleDispatch({
									skipQueuedPolicies: () => Effect.void,
									executePolicy: () => Effect.die("Unexpected policy"),
									after: () =>
										Effect.gen(function* () {
											dispatched += 1;
											const result = yield* Effect.promise(() =>
												observer.query(
													`SELECT (SELECT count(*) FROM event)::int AS events, (SELECT count(*) FROM automation_trigger WHERE category='change')::int AS changes, (SELECT count(*) FROM automation_run)::int AS runs`,
												),
											);
											expect(result.rows).toEqual([
												{ events: 1, runs: dispatched, changes: dispatched },
											]);
											return [];
										}),
								}),
							),
						);
					};
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
					).toEqual([{ runs: 0, events: 0, triggers: 1 }]);
					expect((yield* run("accepted", false)).count).toBe(1);
				}),
		);
	});

	layer(lifecycleDatabaseLayer())((test) => {
		test.effect("snapshots preserve ownership and missing-row semantics", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const repository = yield* EventsRepository;
				const eventId = EventId.make("replay-snapshot");
				const identity = { userId, eventId };
				const otherIdentity = { eventId, userId: UserId.make("another-user") };
				expect(yield* repository.getEventSnapshot(identity)).toBeNull();
				yield* (yield* DatabaseSession).run((db) =>
					db
						.insert(tables.plugin)
						.values({ id: "event-plugin", status: "inactive", slug: "event-fixture" }),
				);
				yield* session.transaction(
					repository.createEvent({
						userId,
						entityId,
						id: eventId,
						eventSchemaSlug,
						sessionEntityId: movedId,
						eventSchemaName: "Rating",
						properties: { rating: 5 },
						eventSchemaPluginId: "event-plugin",
						occurredAt: DateTime.toDate(DateTime.makeUnsafe(now)),
					}),
				);
				const snapshot = yield* repository.getEventSnapshot(identity);
				expect(snapshot).toMatchObject({
					sessionEntityId: movedId,
					properties: { rating: 5 },
					entitySchemaSlug: "record",
				});
				expect(
					yield* repository.listEventIdentitiesForEntities([movedId, entityId, movedId]),
				).toEqual([{ userId, eventId }]);
				expect(yield* repository.getEventSnapshot(otherIdentity)).toBeNull();
			}),
		);

		test.effect("reference moves and deletes retain exact snapshots and advance updatedAt", () =>
			Effect.gen(function* () {
				const { observer } = yield* LifecycleDatabase;
				const repository = yield* EventsRepository;
				const service = yield* EventsService;
				const session = yield* DatabaseSession;
				const currentPlanner = yield* LifecyclePlanner;
				const failingService = yield* EventsService.make.pipe(
					Effect.provideService(LifecyclePlanner, {
						...currentPlanner,
						plan: (input) =>
							currentPlanner.plan(input).pipe(
								Effect.filterOrFail(
									() => input.trigger.kind.category !== "change",
									() => new DbError({ message: "planning failed after run insertion" }),
								),
							),
					}),
				);
				const eventId = EventId.make("event");
				const beforeTime = DateTime.toDate(DateTime.makeUnsafe("2025-01-01T00:00:00.000Z"));
				const created = yield* session.transaction(
					repository.createEvent({
						userId,
						entityId,
						id: eventId,
						eventSchemaSlug,
						occurredAt: beforeTime,
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
						properties: { rating: 3 },
						sessionEntityId: entityId,
					}),
				);
				const replay = yield* session.transaction(
					repository.createEvent({
						userId,
						entityId,
						id: eventId,
						eventSchemaSlug,
						occurredAt: beforeTime,
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
						properties: { rating: 3 },
						sessionEntityId: entityId,
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
								eventSchemaName: "Rating",
								eventSchemaPluginId: null,
								properties: { rating: 9 },
								sessionEntityId: entityId,
							}),
						),
					),
					new DbError({ message: "Conflicting event command identity" }),
				);
				const move = { userId, eventId, mergeInto: movedId, mergeFrom: entityId };
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							name: "Other",
							id: "not-owner",
							email: "not-owner-event@example.test",
							accountGeneration: "test-account-generation",
						}),
				);
				assertExitFails(
					yield* Effect.exit(session.transaction(service.moveReferences(move, command("nested")))),
					new DbError({ message: "Event lifecycle mutations require a root transaction boundary" }),
				);
				assertExitFails(
					yield* Effect.exit(failingService.moveReferences(move, command("failed-move"))),
					new DbError({ message: "planning failed after run insertion" }),
				);
				expect(yield* repository.getEventSnapshot({ userId, eventId })).toMatchObject({
					entityId,
					sessionEntityId: entityId,
					updatedAt: created.createdAt,
				});
				expect(
					yield* service.delete(
						{ eventId, userId: UserId.make("not-owner") },
						rootLifecycleCommand({
							lane: "interactive",
							...command("not-owner"),
							source: "api",
							executionId: AutomationExecutionId.make("not-owner"),
							initiator: { kind: "user", id: UserId.make("not-owner") },
							accountGeneration: {
								userId: UserId.make("not-owner"),
								token: "test-account-generation",
							},
						}),
					),
				).toEqual({ warnings: [], eventId: null });
				expect(yield* service.moveReferences(move, command("move"))).toEqual({
					eventId,
					warnings: [],
				});
				const snapshot = yield* repository.getEventSnapshot({ userId, eventId });
				expect(snapshot).toMatchObject({
					updatedAt: now,
					entityId: movedId,
					sessionEntityId: movedId,
					properties: { rating: 3 },
					createdAt: created.createdAt,
					occurredAt: beforeTime.toISOString(),
				});
				expect(yield* service.moveReferences(move, command("noop"))).toEqual({
					warnings: [],
					eventId: null,
				});
				assertExitFails(
					yield* Effect.exit(failingService.delete({ userId, eventId }, command("failed-delete"))),
					new DbError({ message: "planning failed after run insertion" }),
				);
				expect(yield* repository.getEventSnapshot({ userId, eventId })).toEqual(snapshot);
				expect(yield* service.delete({ userId, eventId }, command("delete"))).toEqual({
					eventId,
					warnings: [],
				});
				expect(yield* service.delete({ userId, eventId }, command("already-deleted"))).toEqual({
					warnings: [],
					eventId: null,
				});
				const result = yield* Effect.promise(() =>
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
				expect(result.rows[0]?.["payload"]).toMatchObject({
					after: snapshot,
					operation: "update",
					before: { entityId, sessionEntityId: entityId, updatedAt: created.createdAt },
				});
				expect(result.rows[1]?.["payload"]).toEqual({
					before: snapshot,
					resource: "event",
					category: "change",
					operation: "delete",
				});
			}),
		);
	});

	layer(lifecycleDatabaseLayer())((test) => {
		test.effect("persists prepared event mutations only in the caller transaction", () =>
			Effect.gen(function* () {
				const { observer } = yield* LifecycleDatabase;
				const session = yield* DatabaseSession;
				const service = yield* EventsService;
				const repository = yield* EventsRepository;
				const lifecyclePlanner = yield* LifecyclePlanner;
				const lifecycleExecution = yield* LifecycleExecution;
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
							eventSchemaName: "Rating",
							eventSchemaPluginId: null,
						}),
					);

				const staleId = EventId.make("prepared-stale");
				yield* seed(staleId);
				const stale = yield* service.prepareMoveReferences(
					{ userId, eventId: staleId, mergeInto: movedId, mergeFrom: entityId },
					command("prepared-stale"),
				);
				assert(stale);
				expect(yield* service.persistPreparedMoveReferences(stale).pipe(Effect.flip)).toMatchObject(
					{ code: "active-transaction-required" },
				);
				yield* session.transaction(
					repository.updateEventEntityReferences({
						userId,
						eventId: staleId,
						mergeInto: movedId,
						mergeFrom: entityId,
						updatedAt: DateTime.toDate(DateTime.makeUnsafe("2026-09-15T00:00:01.000Z")),
					}),
				);
				const staleError = yield* session
					.transaction(service.persistPreparedMoveReferences(stale))
					.pipe(Effect.flip);
				expect(staleError).toMatchObject({ message: "Event changed while lifecycle policies ran" });

				const updateId = EventId.make("prepared-update");
				const deleteId = EventId.make("prepared-delete");
				yield* seed(updateId);
				yield* seed(deleteId);
				const update = yield* service.prepareMoveReferences(
					{ userId, eventId: updateId, mergeInto: movedId, mergeFrom: entityId },
					command("prepared-update"),
				);
				const deletion = yield* service.prepareDelete(
					{ userId, eventId: deleteId },
					command("prepared-delete"),
				);
				assert(update);
				assert(deletion);
				expect(
					yield* session
						.transaction(
							Effect.gen(function* () {
								yield* service.persistPreparedMoveReferences(update);
								yield* service.persistPreparedDelete(deletion);
								const changes = yield* session.run((tx) =>
									tx
										.select()
										.from(tables.automationTrigger)
										.pipe(
											Effect.map((triggers) =>
												triggers.filter(({ category }) => category === "change"),
											),
										),
								);
								expect(changes).toHaveLength(2);
								expect(
									yield* session.run((tx) => tx.select().from(tables.automationRun)),
								).toHaveLength(2);
								return yield* new DbError({ message: "Rollback prepared events" });
							}),
						)
						.pipe(Effect.flip),
				).toMatchObject({ message: "Rollback prepared events" });
				expect(yield* repository.getEventSnapshot({ userId, eventId: updateId })).toMatchObject({
					entityId,
				});
				expect(yield* repository.getEventSnapshot({ userId, eventId: deleteId })).not.toBeNull();
				const rolledBack = yield* Effect.promise(() =>
					observer.query(
						`select (select count(*)::int from automation_trigger where category = 'change') as changes, (select count(*)::int from automation_run) as runs`,
					),
				);
				expect(rolledBack.rows).toEqual([{ runs: 0, changes: 0 }]);

				const committedId = EventId.make("prepared-commit");
				yield* seed(committedId);
				const committedDelete = yield* service.prepareDelete(
					{ userId, eventId: committedId },
					command("prepared-commit"),
				);
				assert(committedDelete);
				const work = yield* session.transaction(service.persistPreparedDelete(committedDelete));
				expect(work.dispatch).toHaveLength(1);

				const rejectedId = EventId.make("prepared-rejected");
				yield* seed(rejectedId);
				const rejectingService = yield* EventsService.make.pipe(
					Effect.provideService(
						LifecyclePlanner,
						withLifecycleBatchPlanning({
							plan: (input) =>
								lifecyclePlanner.plan(input).pipe(
									Effect.map((plan) => {
										assert(plan.trigger);
										return {
											...plan,
											policies: [{ position: 1, runId: AutomationRunId.make("reject-event") }],
										};
									}),
								),
						}),
					),
					Effect.provideService(LifecycleExecution, {
						...lifecycleExecution,
						executePolicy: () =>
							Effect.gen(function* () {
								expect(!(yield* session.isTransactionActive)).toBe(true);
								return { reason: "Rejected", action: "reject" as const };
							}),
					}),
				);
				const rejected = yield* rejectingService
					.prepareDelete({ userId, eventId: rejectedId }, command("prepared-rejected"))
					.pipe(Effect.flip);
				expect(rejected.message).toContain("Event policy rejected mutation");
				expect(yield* repository.getEventSnapshot({ userId, eventId: rejectedId })).not.toBeNull();
			}),
		);
	});

	layer(
		Layer.merge(
			lifecycleDatabaseLayer(false, {
				policyCount: 1,
				changeEntityPropertiesDuringPolicy: true,
				executePolicy: () =>
					Effect.succeed({
						action: "transform",
						patch: { resource: "event", draft: { occurredAt: "2026-09-17T00:00:00.000Z" } },
					}),
			}),
			workflowLayer,
		),
	)((test) => {
		test.effect(
			"rejects an event edit when reference metadata changes during policy execution",
			() =>
				Effect.gen(function* () {
					const service = yield* EventsService;
					const repository = yield* EventsRepository;
					const session = yield* DatabaseSession;
					const eventId = EventId.make("metadata-race-edit-event");
					yield* session.transaction(
						repository.createEvent({
							userId,
							entityId,
							id: eventId,
							eventSchemaSlug,
							properties: { rating: 1 },
							eventSchemaName: "Rating",
							eventSchemaPluginId: null,
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
						}),
					);
					const failure = yield* Effect.flip(
						service.edit(
							updateItem("metadata-race-edit-event", {}),
							userId,
							command("metadata-race-edit"),
						),
					);
					expect(failure).toBeInstanceOf(EventStale);
					expect((yield* repository.getEventSnapshot({ userId, eventId }))?.occurredAt).toBe(now);
				}),
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))((test) => {
		test.effect("keeps no-policy event source work within one transaction", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const measuring = Context.Reference<boolean>("test/EventSourceMeasurement", {
					defaultValue: () => false,
				});
				const transactionCount = yield* Ref.make(0);
				const measuredSession = DatabaseSession.of({
					...session,
					transaction: (work) =>
						Effect.flatMap(measuring, (active) =>
							(active ? Ref.update(transactionCount, (value) => value + 1) : Effect.void).pipe(
								Effect.andThen(session.transaction(work)),
							),
						),
				});
				const repository = yield* EventsRepository.make.pipe(
					Effect.provideService(DatabaseSession, measuredSession),
				);
				const noHooks = yield* Layer.build(
					planner(yield* Ref.make(false), true, yield* Ref.make<ReadonlyArray<string>>([]), 0),
				).pipe(Effect.provideService(DatabaseSession, measuredSession));
				const measuredEngine = makeWorkflowEngine({
					activityExecute: (activity) =>
						Effect.map(
							Effect.exit(
								activity.execute.pipe(
									Effect.provideService(
										measuring,
										activity.name.startsWith("prepare-item-") ||
											activity.name.startsWith("write-event-"),
									),
								),
							),
							(exit) => new Workflow.Complete({ exit }),
						),
				});
				const input = {
					userId,
					command: command("source-operation-fixture"),
					payload: [{ entityId, eventSchemaSlug, properties: { rating: 1 } }],
				};
				const result = yield* runEventCreateWorkflow(input, "source-operation-fixture").pipe(
					Effect.provide(noHooks),
					Effect.provideService(DatabaseSession, measuredSession),
					Effect.provideService(EventsRepository, repository),
					Effect.provideService(WorkflowEngine, measuredEngine),
					Effect.provideService(
						WorkflowInstance,
						WorkflowInstance.initial(EventCreateWorkflow.interactive, "source-operation-fixture"),
					),
				);
				expect(result.count).toBe(1);
				expect(result.failure).toBeNull();
				expect(yield* Ref.get(transactionCount)).toBe(1);
			}),
		);
	});
	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))((test) => {
		test.effect(
			"retires a suspended event owner before reset deletes receipts and fences its replay after same-ID recreation",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const receipts = yield* MutationReceipts.make;
					const payload = {
						userId,
						command: command("reset-suspended-events"),
						payload: [
							{ entityId, eventSchemaSlug, properties: { rating: 1 } },
							{ entityId, eventSchemaSlug, properties: { rating: 2 } },
						],
					};
					const ownerExecutionId = yield* EventCreateWorkflow.interactive.executionId(payload);
					const ownerInstance = WorkflowInstance.initial(
						EventCreateWorkflow.interactive,
						ownerExecutionId,
					);
					const suspended = yield* Ref.make(false);
					const retired = yield* Ref.make<ReadonlyArray<string>>([]);
					const underlying = yield* LifecycleExecution;
					const gatedExecution = LifecycleExecution.of({
						...underlying,
						dispatch: () =>
							Effect.gen(function* () {
								if (!(yield* Ref.get(suspended))) {
									yield* Ref.set(suspended, true);
									return yield* Workflow.suspend(ownerInstance);
								}
								return [];
							}),
					});
					const sourceContext = (yield* Effect.context<
						| DatabaseSession
						| EntitiesRepository
						| EventSchemasRepository
						| EventsRepository
						| LifecyclePlanner
						| LifecycleExecution
					>()).pipe(Context.add(LifecycleExecution, gatedExecution));
					let recordingEngine: WorkflowEngine["Service"];
					recordingEngine = makeWorkflowEngine({
						poll: () => Effect.succeedNone,
						activityExecute: (activity) =>
							Effect.map(Effect.exit(activity.execute), (exit) => new Workflow.Complete({ exit })),
						interrupt: (workflow, executionId) =>
							Effect.gen(function* () {
								expect(workflow._tag).toBe(EventCreateWorkflow.interactive._tag);
								expect(executionId).toBe(ownerExecutionId);
								expect(
									yield* session.run((db) =>
										db
											.select()
											.from(tables.mutationReceipt)
											.where(eq(tables.mutationReceipt.ownerUserId, userId)),
									),
								).not.toHaveLength(0);
								expect(
									yield* session.run((db) =>
										db.select().from(tables.user).where(eq(tables.user.id, userId)),
									),
								).toHaveLength(1);
								yield* Ref.update(retired, (ids) => [...ids, executionId]);
							}).pipe(Effect.orDie),
						execute: (workflow, options) =>
							Effect.gen(function* () {
								if (workflow._tag !== EventCreateWorkflow.interactive._tag) {
									return options.executionId;
								}
								const owners = yield* session.run((db) =>
									db
										.select()
										.from(tables.mutationReceipt)
										.where(
											and(
												eq(tables.mutationReceipt.receiptType, "workflow-owner"),
												eq(tables.mutationReceipt.executionId, options.executionId),
											),
										),
								);
								expect(owners).toHaveLength(1);
								expect(owners[0]?.workflowName).toBe(EventCreateWorkflow.interactive._tag);
								const decoded = yield* Schema.decodeUnknownEffect(EventCreateWorkflowPayload)(
									options.payload,
								);
								const instance =
									options.executionId === ownerExecutionId
										? ownerInstance
										: WorkflowInstance.initial(
												EventCreateWorkflow.interactive,
												options.executionId,
											);
								return yield* runEventCreateWorkflow(decoded, options.executionId).pipe(
									Effect.provide(
										sourceContext.pipe(
											Context.add(WorkflowEngine, recordingEngine),
											Context.add(WorkflowInstance, instance),
										),
									),
								);
							}),
					});
					const events = yield* EventsService.make.pipe(
						Effect.provideService(WorkflowEngine, recordingEngine),
						Effect.provideService(LifecycleExecution, gatedExecution),
					);
					const first = yield* Workflow.intoResult(events.create(payload, payload.command)).pipe(
						Effect.provideService(WorkflowInstance, ownerInstance),
					);
					expect(first._tag).toBe("Suspended");
					expect(ownerExecutionId).not.toBe(payload.command.causation.executionId);
					expect(yield* session.run((db) => db.select().from(tables.event))).toHaveLength(1);
					const [item] = yield* session.run((db) =>
						db
							.select()
							.from(tables.mutationReceipt)
							.where(
								and(
									eq(tables.mutationReceipt.receiptType, "item"),
									eq(tables.mutationReceipt.commandKind, "event:create"),
								),
							),
					);
					assert(item);
					const identity = yield* Schema.decodeEffect(MutationReceiptIdentity)(item);
					const auth = Context.get(
						yield* Layer.build(
							Layer.mock(AuthService)({
								purgeApiKeyCaches: () => Effect.void,
								deleteUserSessions: () => Effect.void,
								revokeUserOAuthTokens: () => Effect.void,
								revokePasswordResetLinks: () => Effect.void,
								handler: () => Effect.die("unused").pipe(Effect.runPromise),
								requestPasswordResetLink: (email) =>
									Effect.succeed({ email, resetUrl: "https://example.test/reset" }),
								updateAuthUserDisabled: (id, data) =>
									session
										.run((db) => db.update(tables.user).set(data).where(eq(tables.user.id, id)))
										.pipe(Effect.asVoid),
								createAuthUser: (input) =>
									session
										.run((db) => db.insert(tables.user).values(input).returning())
										.pipe(
											Effect.map((rows) => {
												const row = rows[0];
												assert(row);
												return row;
											}),
										),
							}),
						),
						AuthService,
					);
					const repository = yield* UserLifecycleRepository.make.pipe(
						Effect.provideService(ImportsRepository, yield* ImportsRepository),
					);
					const lifecycle = yield* UserLifecycleService.make.pipe(
						Effect.provideService(AuthService, auth),
						Effect.provideService(UserLifecycleRepository, repository),
						Effect.provideService(WorkflowEngine, recordingEngine),
					);
					const { operationId } = yield* lifecycle.resetUser(userId);
					expect(yield* receipts.peek(identity, Schema.Unknown).pipe(Effect.flip)).toMatchObject({
						message: "Mutation command account is being retired",
					});
					const storage = Context.get(
						yield* Layer.build(
							Layer.mock(ObjectStorageService)({ deleteObject: () => Effect.void }),
						),
						ObjectStorageService,
					);
					const operations = Context.get(
						yield* Layer.build(
							UserLifecycleWorkflowOperationsLive.pipe(Layer.provide(ingestionRetirementTestLayer)),
						).pipe(
							Effect.provideService(
								AdmittedWorkflowCatalogue,
								Object.freeze([EventCreateWorkflow.interactive]),
							),
							Effect.provideService(AuthService, auth),
							Effect.provideService(UserLifecycleRepository, repository),
							Effect.provideService(ObjectStorageService, storage),
							Effect.provideService(WorkflowEngine, recordingEngine),
						),
						UserLifecycleWorkflowOperations,
					);
					yield* runUserLifecycleWorkflow({ operationId }, `user-lifecycle-${operationId}-0`).pipe(
						Effect.provideService(UserLifecycleWorkflowOperations, operations),
						Effect.provideService(WorkflowEngine, recordingEngine),
						Effect.provideService(
							WorkflowInstance,
							WorkflowInstance.initial(UserLifecycleWorkflow, `user-lifecycle-${operationId}-0`),
						),
					);
					expect(yield* Ref.get(retired)).toEqual([ownerExecutionId]);
					expect((yield* repository.getInternalById(operationId))?.operation.status).toBe(
						"completed",
					);
					expect(yield* session.run((db) => db.select().from(tables.event))).toEqual([]);
					expect(
						yield* session.run((db) =>
							db
								.select()
								.from(tables.mutationReceipt)
								.where(eq(tables.mutationReceipt.receiptType, "item")),
						),
					).toEqual([]);
					const accountGeneration = yield* receipts.currentAccount(userId);
					expect(accountGeneration.token).not.toBe(payload.command.accountGeneration?.token);
					expect(yield* receipts.peek(identity, Schema.Unknown).pipe(Effect.flip)).toMatchObject({
						message: "Mutation command belongs to a retired account",
					});
					expect(
						yield* runEventCreateWorkflow(payload, ownerExecutionId).pipe(
							Effect.provideService(WorkflowEngine, recordingEngine),
							Effect.provideService(
								WorkflowInstance,
								WorkflowInstance.initial(EventCreateWorkflow.interactive, ownerExecutionId),
							),
							Effect.flip,
						),
					).toMatchObject({ message: "Mutation command belongs to a retired account" });
					expect(yield* session.run((db) => db.select().from(tables.event))).toEqual([]);
					const fresh = {
						...payload,
						payload: payload.payload.slice(0, 1),
						command: { ...command("reset-fresh-events"), accountGeneration },
					};
					expect((yield* events.create(fresh, fresh.command)).count).toBe(1);
					expect(yield* session.run((db) => db.select().from(tables.event))).toHaveLength(1);
				}),
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))((test) => {
		test.effect("commits no-hook updates and deletes with their receipts in one transaction", () =>
			Effect.gen(function* () {
				const service = yield* EventsService;
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
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
					}),
				);
				const move = { userId, eventId, mergeInto: movedId, mergeFrom: entityId };
				const updated = yield* service.moveReferences(move, command("no-hook-update"));
				expect(updated).toEqual({ eventId, warnings: [] });
				expect((yield* repository.getEventSnapshot({ userId, eventId }))?.entityId).toBe(movedId);
				const noop = yield* service.moveReferences(move, command("no-hook-noop"));
				expect(noop).toEqual({ warnings: [], eventId: null });
				yield* session.transaction(
					repository.updateEventEntityReferences({
						...move,
						mergeFrom: movedId,
						mergeInto: entityId,
						updatedAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
					}),
				);
				expect(yield* service.moveReferences(move, command("no-hook-noop"))).toEqual(noop);
				expect((yield* repository.getEventSnapshot({ userId, eventId }))?.entityId).toBe(entityId);
				expect(
					yield* service
						.moveReferences({ ...move, mergeInto: entityId }, command("no-hook-noop"))
						.pipe(Effect.flip),
				).toMatchObject({ message: "Conflicting event command identity" });
				const deleted = yield* service.delete({ userId, eventId }, command("no-hook-delete"));
				expect(deleted).toEqual({ eventId, warnings: [] });
				expect(yield* service.moveReferences(move, command("no-hook-update"))).toEqual(updated);
				expect(yield* service.delete({ userId, eventId }, command("no-hook-delete"))).toEqual(
					deleted,
				);
				const missingId = EventId.make("no-hook-missing-delete");
				const missingCommand = command("no-hook-missing-delete");
				expect(yield* service.delete({ userId, eventId: missingId }, missingCommand)).toEqual({
					warnings: [],
					eventId: null,
				});
				yield* session.transaction(
					repository.createEvent({
						userId,
						entityId,
						id: missingId,
						properties: {},
						eventSchemaSlug,
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
					}),
				);
				expect(yield* service.delete({ userId, eventId: missingId }, missingCommand)).toEqual({
					warnings: [],
					eventId: null,
				});
				expect(yield* repository.getEventSnapshot({ userId, eventId: missingId })).not.toBeNull();
				expect(yield* session.run((db) => db.select().from(tables.event))).toHaveLength(1);
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
				const receipts = yield* session.run((db) => db.select().from(tables.mutationReceipt));
				expect(receipts.filter(({ receiptType }) => receiptType === "item")).toHaveLength(4);
				expect(receipts.every(({ evidence }) => evidence === null)).toBe(true);
				const transactions = yield* fixture.planTransactions;
				expect(transactions).toHaveLength(4);
				expect(transactions[0]).toBe(transactions[1]);
				expect(transactions[2]).toBe(transactions[3]);
			}),
		);
	});

	const policyInputs: Array<Parameters<LifecycleExecution["Service"]["executePolicy"]>[0]> = [];
	layer(
		Layer.merge(
			lifecycleDatabaseLayer(false, {
				policyCount: 2,
				executePolicy: (input) => {
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
			workflowLayer,
		),
	)((test) => {
		test.effect("applies event policy transforms in order and replays the raw submitted edit", () =>
			Effect.gen(function* () {
				policyInputs.length = 0;
				const service = yield* EventsService;
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
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
					}),
				);
				const submitted = updateItem("policy-edit-event", {
					properties: { remove: [], set: { rating: 2 } },
				});
				const lifecycle = command("policy-edit");
				expect(yield* service.edit(submitted, userId, lifecycle)).toEqual({
					eventId,
					warnings: [],
				});
				expect(policyInputs).toHaveLength(2);
				expect(policyInputs[1]?.acceptedPatches).toEqual([
					{
						resource: "event",
						draft: {
							occurredAt: "2026-09-16T00:00:00.000Z",
							properties: { remove: [], set: { rating: 10 } },
						},
					},
				]);
				expect((yield* repository.getEventSnapshot({ userId, eventId }))?.properties).toEqual({
					rating: 10,
				});
				expect(yield* service.edit(submitted, userId, lifecycle)).toEqual({
					eventId,
					warnings: [],
				});
				expect(policyInputs).toHaveLength(2);
				const conflict = yield* Effect.flip(
					service.edit(
						updateItem("policy-edit-event", { properties: { remove: [], set: { rating: 11 } } }),
						userId,
						lifecycle,
					),
				);
				expect(conflict).toMatchObject({
					_tag: "EventBadRequest",
					reason: { code: "mutation-conflict" },
				});
				expect(policyInputs).toHaveLength(2);

				const moveEventId = EventId.make("policy-move-event");
				yield* session.transaction(
					repository.createEvent({
						userId,
						entityId,
						id: moveEventId,
						eventSchemaSlug,
						properties: { rating: 1 },
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
					}),
				);
				policyInputs.length = 0;
				const move = { userId, mergeInto: movedId, mergeFrom: entityId, eventId: moveEventId };
				const moveCommand = command("policy-move");
				expect(yield* service.moveReferences(move, moveCommand)).toEqual({
					warnings: [],
					eventId: moveEventId,
				});
				expect(policyInputs[1]?.acceptedPatches).toEqual([
					{
						resource: "event",
						draft: {
							occurredAt: "2026-09-16T00:00:00.000Z",
							properties: { remove: [], set: { rating: 10 } },
						},
					},
				]);
				const moved = yield* repository.getEventSnapshot({ userId, eventId: moveEventId });
				expect(moved).toMatchObject({
					entityId: movedId,
					properties: { rating: 10 },
					occurredAt: "2026-09-16T00:00:00.000Z",
				});
				expect(yield* service.moveReferences(move, moveCommand)).toEqual({
					warnings: [],
					eventId: moveEventId,
				});
				expect(policyInputs).toHaveLength(2);
			}),
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))((test) => {
		test.effect("rejects invalid event properties and unreadable references", () =>
			Effect.gen(function* () {
				const service = yield* EventsService;
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
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
					}),
				);
				const invalidProperties = yield* Effect.flip(
					service.edit(
						updateItem("invalid-edit-event", {
							properties: { remove: [], set: { rating: "invalid" } },
						}),
						userId,
						command("invalid-edit-properties"),
					),
				);
				expect(invalidProperties).toMatchObject({
					_tag: "EventBadRequest",
					reason: { code: "invalid-properties" },
				});
				const unreadableReference = yield* Effect.flip(
					service.edit(
						updateItem("invalid-edit-event", { entityId: EntityId.make("unreadable") }),
						userId,
						command("unreadable-edit-reference"),
					),
				);
				expect(unreadableReference).toMatchObject({
					_tag: "EventBadRequest",
					reason: { code: "mutation-conflict" },
				});
				expect((yield* repository.getEventSnapshot({ userId, eventId }))?.properties).toEqual({
					rating: 1,
				});
			}),
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))((test) => {
		test.effect("rejects a stale event revision when updatedAt is unchanged", () =>
			Effect.gen(function* () {
				const service = yield* EventsService;
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
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
					}),
				);
				const prepared = yield* service.prepareUpdate(
					updateItem("stale-edit-event", { properties: { remove: [], set: { rating: 2 } } }),
					userId,
					command("stale-edit"),
				);
				assert(prepared);
				const before = yield* repository.getEventSnapshot({ userId, eventId });
				assert(before);
				yield* session.transaction(
					repository.updateEventEntityReferences({
						userId,
						eventId,
						mergeInto: movedId,
						mergeFrom: entityId,
						updatedAt: DateTime.toDateUtc(DateTime.makeUnsafe(before.updatedAt)),
					}),
				);
				const after = yield* repository.getEventSnapshot({ userId, eventId });
				assert(after);
				expect(after.updatedAt).toBe(before.updatedAt);
				const stale = yield* session
					.transaction(service.persistPreparedUpdate(prepared))
					.pipe(Effect.flip);
				expect(stale).toMatchObject({
					_tag: "EventStale",
					reason: { eventId, code: "event-stale" },
				});
			}),
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(), workflowLayer))((test) => {
		test.effect("rolls back every event in a failed atomic update batch", () =>
			Effect.gen(function* () {
				const service = yield* EventsService;
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
							eventSchemaName: "Rating",
							eventSchemaPluginId: null,
							occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
						}),
					);
				}
				yield* fixture.failChangePlanning(true);
				const failure = yield* Effect.flip(
					service.updateBatch(
						eventIds.map((eventId, index) =>
							updateItem(eventId, { properties: { remove: [], set: { rating: index + 2 } } }),
						),
						userId,
						command("atomic-event-edit"),
					),
				);
				expect(failure).toMatchObject({ message: "planning failed after run insertion" });
				for (const eventId of eventIds) {
					expect((yield* repository.getEventSnapshot({ userId, eventId }))?.properties).toEqual({
						rating: 1,
					});
				}
				expect(
					yield* session.run((db) =>
						db
							.select()
							.from(tables.mutationReceipt)
							.where(eq(tables.mutationReceipt.commandKind, "event:edit")),
					),
				).toEqual([]);
			}),
		);
	});

	layer(Layer.merge(lifecycleDatabaseLayer(true), workflowLayer))((test) => {
		test.effect("replays a committed event delete batch", () =>
			Effect.gen(function* () {
				const service = yield* EventsService;
				const repository = yield* EventsRepository;
				const session = yield* DatabaseSession;
				const eventId = EventId.make("delete-batch-event");
				yield* session.transaction(
					repository.createEvent({
						userId,
						entityId,
						id: eventId,
						eventSchemaSlug,
						properties: { rating: 1 },
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
						occurredAt: DateTime.toDateUtc(DateTime.makeUnsafe(now)),
					}),
				);
				const lifecycle = command("delete-event-batch");
				expect(yield* service.deleteBatch([eventId], userId, lifecycle)).toEqual({
					count: 1,
					warnings: [],
				});
				expect(yield* service.deleteBatch([eventId], userId, lifecycle)).toEqual({
					count: 1,
					warnings: [],
				});
				expect(yield* repository.getEventSnapshot({ userId, eventId })).toBeNull();
			}),
		);
	});
});
