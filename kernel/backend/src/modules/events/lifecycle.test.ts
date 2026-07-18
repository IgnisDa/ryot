import { PgClient } from "@effect/sql-pg";
import { assert, describe, expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { DEFAULT_AUTOMATION_RETRY_POLICY } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	AutomationRunId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { DateTime, Effect, Layer, Option, Redacted } from "effect";
import { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/unstable/workflow/WorkflowEngine";
import { Client } from "pg";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, DatabaseLive, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";
import { testDatabaseUrl } from "#lib/test-utils/database";
import {
	makeAppConfigLayer,
	makeConfigProviderLayer,
	makeWorkflowEngine,
} from "#lib/test-utils/effect";
import {
	withLifecycleBatchPlanning,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventSchemasRepository } from "#modules/event-schemas/repository";

import { EventCreateWorkflow } from "./event-create-workflow";
import { runEventCreateWorkflow } from "./event-create-workflow-live";
import { EventsRepository } from "./repository";
import { EventsService } from "./service";

const url = testDatabaseUrl();
const userId = UserId.make("event-owner");
const entityId = EntityId.make("event-subject");
const movedId = EntityId.make("event-moved-subject");
const eventSchemaSlug = EventSchemaSlug.make("rating");
const now = "2026-09-15T00:00:00.000Z";
const command = (id: string) =>
	rootLifecycleCommand({
		source: "api",
		occurredAt: now,
		itemIdentity: "event",
		initiator: { id: userId, kind: "user" },
		executionId: AutomationExecutionId.make(id),
	});

const withDatabase = <E, R>(test: (observer: Client) => Effect.Effect<void, E, R>) =>
	Effect.scoped(
		Effect.gen(function* () {
			assert(url);
			const name = `event_test_${crypto.randomUUID().replaceAll("-", "")}`;
			const admin = yield* Effect.acquireRelease(
				Effect.gen(function* () {
					const client = new Client({ connectionString: url });
					yield* Effect.tryPromise(() => client.connect());
					return client;
				}),
				(client) =>
					Effect.promise(() => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)).pipe(
						Effect.andThen(Effect.promise(() => client.end())),
					),
			);
			yield* Effect.tryPromise(() => admin.query(`CREATE DATABASE "${name}"`));
			const scoped = new URL(url);
			scoped.pathname = `/${name}`;
			const observer = yield* Effect.acquireRelease(
				Effect.gen(function* () {
					const client = new Client({ connectionString: scoped.toString() });
					yield* Effect.tryPromise(() => client.connect());
					return client;
				}),
				(client) => Effect.promise(() => client.end()),
			);
			const directory = new URL("../../drizzle/", import.meta.url).pathname;
			const paths = [...new Bun.Glob("*/migration.sql").scanSync({ cwd: directory })];
			assert(paths.length === 1);
			const ddl = yield* Effect.tryPromise(() => Bun.file(directory + paths[0]).text());
			for (const statement of ddl.split("--> statement-breakpoint")) {
				yield* Effect.tryPromise(() => observer.query(statement));
			}
			yield* Effect.tryPromise(() =>
				observer.query(
					`INSERT INTO "user" (id,name,email,preferences) VALUES ($1,'Owner','event@example.test','{}');`,
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
			const layer = Layer.mergeAll(DatabaseLive, EventsRepository.layer).pipe(
				Layer.provideMerge(
					makeAppConfigLayer({ database: { url: Redacted.make(scoped.toString()) } }),
				),
				Layer.provideMerge(makeConfigProviderLayer()),
			);
			yield* test(observer).pipe(Effect.provide(layer));
		}),
	);

const planner = (failChange = false) =>
	Layer.succeed(
		LifecyclePlanner,
		withLifecycleBatchPlanning({
			plan: ({ trigger }) =>
				Effect.gen(function* () {
					const db = yield* Database;
					const { kind, causation } = trigger;
					yield* mapDatabaseErrors(
						db
							.insert(tables.automationTrigger)
							.values({
								id: trigger.id,
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
						yield* mapDatabaseErrors(
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
						if (failChange) {
							return yield* new DbError({ message: "planning failed after run insertion" });
						}
					}
					return { trigger, runs: [], policies: [], wasCreated: true };
				}),
		}),
	);

const workflowLayer = Layer.mergeAll(
	Layer.mock(EntitiesRepository)({
		lockEntityReferencesByIds: () => Effect.void,
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
const execution = Layer.succeed(
	LifecycleExecution,
	withLifecycleDispatch({
		after: () => Effect.succeed([]),
		skipQueuedPolicies: () => Effect.void,
		executePolicy: () => Effect.die("Unexpected policy"),
	}),
);

describe("Event lifecycle PostgreSQL", () => {
	it.effect("event, change trigger and queued runs commit together and roll back together", () =>
		withDatabase((observer) =>
			Effect.gen(function* () {
				const run = (id: string, fail: boolean) => {
					let dispatched = 0;
					return runEventCreateWorkflow(
						{
							userId,
							command: command(id),
							payload: [{ entityId, properties: {}, eventSchemaSlug }],
						},
						id,
					).pipe(
						Effect.provide(Layer.mergeAll(workflowLayer, planner(fail))),
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(
							WorkflowInstance,
							WorkflowInstance.initial(EventCreateWorkflow, id),
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
		),
	);

	it.effect("reference moves and deletes retain exact snapshots and advance updatedAt", () =>
		withDatabase((observer) =>
			Effect.gen(function* () {
				const repository = yield* EventsRepository;
				const service = yield* EventsService;
				const eventId = EventId.make("event");
				const beforeTime = DateTime.toDate(DateTime.makeUnsafe("2025-01-01T00:00:00.000Z"));
				const created = yield* repository.createEvent({
					userId,
					entityId,
					id: eventId,
					eventSchemaSlug,
					occurredAt: beforeTime,
					eventSchemaName: "Rating",
					eventSchemaPluginId: null,
					properties: { rating: 3 },
					sessionEntityId: entityId,
				});
				const replay = yield* repository.createEvent({
					userId,
					entityId,
					id: eventId,
					eventSchemaSlug,
					occurredAt: beforeTime,
					eventSchemaName: "Rating",
					eventSchemaPluginId: null,
					properties: { rating: 3 },
					sessionEntityId: entityId,
				});
				expect(replay.id).toBe(eventId);
				assertExitFails(
					yield* Effect.exit(
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
					new DbError({ message: "Conflicting event command identity" }),
				);
				const move = { userId, eventId, mergeInto: movedId, mergeFrom: entityId };
				const database = yield* Database;
				assertExitFails(
					yield* Effect.exit(
						mapDatabaseErrors(
							database.transaction((tx) =>
								service.update(move, command("nested")).pipe(Effect.provideService(Database, tx)),
							),
						),
					),
					new DbError({ message: "Event lifecycle mutations require a root transaction boundary" }),
				);
				assertExitFails(
					yield* Effect.exit(
						service.update(move, command("failed-move")).pipe(Effect.provide(planner(true))),
					),
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
						command("not-owner"),
					),
				).toEqual({ warnings: [], eventId: null });
				expect(yield* service.update(move, command("move"))).toEqual({ eventId, warnings: [] });
				const snapshot = yield* repository.getEventSnapshot({ userId, eventId });
				expect(snapshot).toMatchObject({
					updatedAt: now,
					entityId: movedId,
					sessionEntityId: movedId,
					properties: { rating: 3 },
					createdAt: created.createdAt,
					occurredAt: beforeTime.toISOString(),
				});
				expect(yield* service.update(move, command("noop"))).toEqual({
					warnings: [],
					eventId: null,
				});
				assertExitFails(
					yield* Effect.exit(
						service
							.delete({ userId, eventId }, command("failed-delete"))
							.pipe(Effect.provide(planner(true))),
					),
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
		).pipe(
			Effect.provide(
				Layer.mergeAll(
					EventsService.layer.pipe(
						Layer.provideMerge(EventsRepository.layer),
						Layer.provideMerge(Layer.succeed(WorkflowEngine, engine)),
					),
					planner(),
					execution,
				),
			),
		),
	);

	it.effect("persists prepared event mutations only in the caller transaction", () =>
		withDatabase((observer) =>
			Effect.gen(function* () {
				const db = yield* Database;
				const client = yield* PgClient.PgClient;
				const service = yield* EventsService;
				const repository = yield* EventsRepository;
				const lifecyclePlanner = yield* LifecyclePlanner;
				const lifecycleExecution = yield* LifecycleExecution;
				const createdAt = DateTime.toDate(DateTime.makeUnsafe("2025-01-01T00:00:00.000Z"));
				const seed = (id: string) =>
					repository.createEvent({
						userId,
						entityId,
						eventSchemaSlug,
						id: EventId.make(id),
						occurredAt: createdAt,
						properties: { rating: 3 },
						eventSchemaName: "Rating",
						eventSchemaPluginId: null,
					});

				const staleId = EventId.make("prepared-stale");
				yield* seed(staleId);
				const stale = yield* service.prepareUpdate(
					{ userId, eventId: staleId, mergeInto: movedId, mergeFrom: entityId },
					command("prepared-stale"),
				);
				assert(stale);
				expect(yield* service.persistPreparedUpdate(stale).pipe(Effect.flip)).toMatchObject({
					code: "active-transaction-required",
				});
				yield* repository.updateEventEntityReferences({
					userId,
					eventId: staleId,
					mergeInto: movedId,
					mergeFrom: entityId,
					updatedAt: DateTime.toDate(DateTime.makeUnsafe("2026-09-15T00:00:01.000Z")),
				});
				const staleError = yield* db
					.transaction((tx) =>
						service.persistPreparedUpdate(stale).pipe(Effect.provideService(Database, tx)),
					)
					.pipe(Effect.flip);
				expect(staleError).toMatchObject({ message: "Event changed while lifecycle policies ran" });

				const updateId = EventId.make("prepared-update");
				const deleteId = EventId.make("prepared-delete");
				yield* seed(updateId);
				yield* seed(deleteId);
				const update = yield* service.prepareUpdate(
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
					yield* db
						.transaction((tx) =>
							Effect.gen(function* () {
								yield* service.persistPreparedUpdate(update);
								yield* service.persistPreparedDelete(deletion);
								const changes = (yield* tx.select().from(tables.automationTrigger)).filter(
									({ category }) => category === "change",
								);
								expect(changes).toHaveLength(2);
								expect(yield* tx.select().from(tables.automationRun)).toHaveLength(2);
								return yield* new DbError({ message: "Rollback prepared events" });
							}).pipe(Effect.provideService(Database, tx)),
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
				const work = yield* db.transaction((tx) =>
					service.persistPreparedDelete(committedDelete).pipe(Effect.provideService(Database, tx)),
				);
				expect(work.plans).toHaveLength(1);

				const rejectedId = EventId.make("prepared-rejected");
				yield* seed(rejectedId);
				const rejected = yield* service
					.prepareDelete({ userId, eventId: rejectedId }, command("prepared-rejected"))
					.pipe(
						Effect.provideService(
							LifecyclePlanner,
							withLifecycleBatchPlanning({
								plan: (input) =>
									lifecyclePlanner
										.plan(input)
										.pipe(
											Effect.map((plan) => ({
												...plan,
												policies: [{ position: 1, runId: AutomationRunId.make("reject-event") }],
											})),
										),
							}),
						),
						Effect.provideService(LifecycleExecution, {
							...lifecycleExecution,
							executePolicy: () =>
								Effect.gen(function* () {
									expect(
										Option.isNone(yield* Effect.serviceOption(client.transactionService)),
									).toBe(true);
									return { reason: "Rejected", action: "reject" as const };
								}),
						}),
						Effect.flip,
					);
				expect(rejected.message).toContain("Event policy rejected mutation");
				expect(yield* repository.getEventSnapshot({ userId, eventId: rejectedId })).not.toBeNull();
			}),
		).pipe(
			Effect.provide(
				Layer.mergeAll(
					EventsService.layer.pipe(
						Layer.provideMerge(EventsRepository.layer),
						Layer.provideMerge(Layer.succeed(WorkflowEngine, engine)),
					),
					planner(),
					execution,
				),
			),
		),
	);
});
