import { assert, expect, layer } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, DateTime, Effect, Layer, Ref } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { fakeDatabaseSession } from "#lib/test-utils/effect";
import type { MockOverrides } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { restorePersistenceWithDatabase } from "#modules/backups/restore/persistence.test-support";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EventsRepository } from "#modules/events/repository";
import { EventStreamRepository } from "#modules/events/stream-repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntitiesRepository } from "./repository";

const mockPluginRuntime = Layer.mock(PluginRuntimeResolver);

const makePluginRuntime = (overrides: MockOverrides<typeof mockPluginRuntime> = {}) =>
	mockPluginRuntime({ ...overrides });

const repositoryWithDatabase = (db: object, pluginRuntime = makePluginRuntime()) => {
	const database = Object.assign(Object.create(null), db);
	return Layer.merge(
		EntitiesRepository.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.mock(DefinitionRepository)({}),
					pluginRuntime,
					fakeDatabaseSession(database),
				),
			),
		),
		fakeDatabaseSession(database),
	);
};

class RecordedQueries extends Context.Service<
	RecordedQueries,
	{ readonly entries: Effect.Effect<ReadonlyArray<unknown>> }
>()("test/RecordedQueries") {}

type Recorder = (entry: unknown) => Effect.Effect<void>;

const recordingLayer = <A>(
	provide: (db: object) => Layer.Layer<A>,
	makeDb: (record: Recorder) => object,
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const entries = yield* Ref.make<ReadonlyArray<unknown>>([]);
			const db = makeDb((entry) => Ref.update(entries, (all) => [...all, entry]));
			return Layer.merge(
				provide(db),
				Layer.succeed(RecordedQueries, { entries: Ref.get(entries) }),
			);
		}),
	);

const recordedEntries = Effect.flatMap(RecordedQueries, (recorded) => recorded.entries);

class FakeEntityTable extends Context.Service<
	FakeEntityTable,
	{
		readonly rows: Effect.Effect<ReadonlyArray<Record<string, unknown>>>;
		readonly lockedReads: Effect.Effect<number>;
	}
>()("test/FakeEntityTable") {}

const entityTableLayer = Layer.unwrap(
	Effect.gen(function* () {
		const rows = yield* Ref.make<ReadonlyArray<Record<string, unknown>>>([]);
		const lockedReads = yield* Ref.make(0);
		const insert = () => ({
			values: (values: Record<string, unknown>) => ({
				onConflictDoNothing: () => ({
					returning: () =>
						Ref.modify(rows, (current) => {
							if (
								current.some(
									(row) =>
										row["userId"] === values["userId"] &&
										row["externalId"] === values["externalId"] &&
										row["providerId"] === values["providerId"] &&
										row["entitySchemaSlug"] === values["entitySchemaSlug"] &&
										row["entitySchemaPluginId"] === values["entitySchemaPluginId"],
								)
							) {
								return [[], current];
							}

							const row = {
								...values,
								id: `entity-${current.length + 1}`,
								createdAt: new Date("2026-07-20T00:00:00.000Z"),
								updatedAt: new Date("2026-07-20T00:00:00.000Z"),
							};
							return [[row], [...current, row]];
						}),
				}),
			}),
		});
		const select = () => ({
			from: () => ({
				where: () => ({
					limit: () => ({
						for: () =>
							Ref.update(lockedReads, (count) => count + 1).pipe(
								Effect.andThen(Ref.get(rows)),
								Effect.map((current) => current.slice(0, 1)),
							),
					}),
				}),
			}),
		});
		return Layer.merge(
			repositoryWithDatabase({ insert, select }),
			Layer.succeed(FakeEntityTable, { rows: Ref.get(rows), lockedReads: Ref.get(lockedReads) }),
		);
	}),
);

const providerId = SandboxProviderId.make("provider-1");
const detailsScriptId = SandboxScriptId.make("details-script-1");

layer(
	repositoryWithDatabase(
		{},
		makePluginRuntime({
			findSchemaProviderBySlug: () =>
				Effect.succeed({
					entitySchemaSlug: EntitySchemaSlug.make("person"),
					provider: {
						id: providerId,
						name: "Fixture",
						pluginId: "fixture",
						createdAt: new Date(0),
						updatedAt: new Date(0),
						slug: "fixture-provider",
						rootEntitySchemaSlug: "person",
						information: { source: "fixture" },
					},
				}),
			findDetailsScript: () =>
				Effect.succeed({
					providerId,
					name: "Details",
					source: "source",
					compiledFormat: 1,
					id: detailsScriptId,
					optionsSchema: null,
					pluginId: "fixture",
					pluginRevisionId: null,
					createdAt: new Date(0),
					updatedAt: new Date(0),
					slug: "fixture.details",
					compiledCode: "compiled",
					contentHash: "details-hash",
					metadata: { kind: "provider" as const },
				}),
		}),
	),
)((test) => {
	test.effect("resolves provider identity and its active details executable", () =>
		Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const resolved = yield* repository.findEntitySchemaProviderBySlug("fixture-provider");

			expect(resolved).toEqual({
				providerId,
				detailsScriptId,
				entitySchemaSlug: EntitySchemaSlug.make("person"),
			});
		}),
	);
});

layer(entityTableLayer)((test) => {
	test.effect("keeps kernel and plugin entities with the same natural key separate", () => {
		const input = {
			name: "Entity",
			populatedAt: null,
			scope: "global" as const,
			externalId: "external-1",
			properties: { status: "active" },
			providerId: SandboxProviderId.make("provider-1"),
			entitySchemaSlug: EntitySchemaSlug.make("schema-1"),
		};

		return Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			yield* repository.insertEntity({ ...input, entitySchemaPluginId: null });
			yield* repository.insertEntity({ ...input, entitySchemaPluginId: "plugin-1" });

			const rows = yield* (yield* FakeEntityTable).rows;
			expect(rows.map(({ entitySchemaPluginId }) => entitySchemaPluginId)).toEqual([
				null,
				"plugin-1",
			]);
		});
	});
});

layer(entityTableLayer)((test) => {
	test.effect("distinguishes an insert from a locked conflict row", () => {
		const input = {
			name: "Entity",
			populatedAt: null,
			scope: "global" as const,
			externalId: "external-1",
			entitySchemaPluginId: null,
			properties: { status: "active" },
			providerId: SandboxProviderId.make("provider-1"),
			entitySchemaSlug: EntitySchemaSlug.make("schema-1"),
		};

		return Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const created = yield* repository.insertEntity(input);
			const conflicted = yield* repository.insertEntity(input);

			expect(created.wasInserted).toBe(true);
			expect(conflicted.wasInserted).toBe(false);
			expect(conflicted.entity).toEqual(created.entity);
			expect(yield* (yield* FakeEntityTable).lockedReads).toBe(1);
		});
	});
});

const dialect = new PgDialect();
type Statement = Parameters<typeof dialect.sqlToQuery>[0];

layer(
	recordingLayer(repositoryWithDatabase, (record) => ({
		select: () => ({ from: () => ({ where: () => Effect.succeed([{ count: 7 }]) }) }),
		execute: (statement: Statement) => {
			const query = dialect.sqlToQuery(statement);
			return record(`${query.sql}:${query.params.join(":")}`);
		},
	})),
)((test) => {
	test.effect("locks and counts the complete global provenance scope", () =>
		Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const input = {
				entitySchemaPluginId: "plugin-1",
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("person"),
			};
			yield* repository.lockGlobalEntityProvenanceScope(input);
			const total = yield* repository.countGlobalEntitiesByProvenanceScope(input);

			const executed = yield* recordedEntries;
			expect(total).toBe(7);
			expect(executed).toHaveLength(1);
			expect(executed[0]).toContain("pg_advisory_xact_lock");
			expect(executed[0]).toContain("global-entities:person:plugin-1:provider-1");
		}),
	);
});

layer(
	recordingLayer(repositoryWithDatabase, (record) => ({
		execute: (statement: Statement) => record(String(dialect.sqlToQuery(statement).params[0])),
	})),
)((test) => {
	test.effect("locks provider entity identities in canonical order", () =>
		Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const common = {
				scope: "global" as const,
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("person"),
			};
			yield* repository.lockProviderEntityMutations([
				{ ...common, externalId: "zeta" },
				{ ...common, externalId: "alpha" },
				{ ...common, externalId: "zeta" },
			]);

			expect(yield* recordedEntries).toEqual([
				'["provider-entity","global","global","person","provider-1","alpha"]',
				'["provider-entity","global","global","person","provider-1","zeta"]',
			]);
		}),
	);
});

layer(
	recordingLayer(repositoryWithDatabase, (record) => ({
		select: () => ({
			from: () => {
				let predicateParams: unknown[] = [];
				let ordered = false;
				const query = {
					orderBy: (_column: unknown) => {
						ordered = true;
						return query;
					},
					for: (strength: string) =>
						record({ ordered, strength, predicateParams }).pipe(Effect.as([])),
					where: (condition: { getSQL: () => Statement }) => {
						predicateParams = dialect.sqlToQuery(condition.getSQL()).params;
						return query;
					},
				};
				return query;
			},
		}),
	})),
)((test) => {
	test.effect("locks unique entity references in canonical order", () =>
		Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			yield* repository.lockEntityReferencesByIds([
				EntityId.make("zeta"),
				EntityId.make("alpha"),
				EntityId.make("zeta"),
			]);

			expect(yield* recordedEntries).toEqual([
				{ ordered: true, strength: "key share", predicateParams: ["alpha", "zeta"] },
			]);
		}),
	);
});

layer(
	recordingLayer(restorePersistenceWithDatabase, (record) => ({
		insert: () => ({
			values: (values: Record<string, unknown>) => ({
				returning: () => record(values).pipe(Effect.as([{ id: values["id"] }])),
			}),
		}),
	})),
)((test) => {
	test.effect("restores an entity with its archived identity and timestamps", () => {
		const input = {
			name: "Archived",
			externalId: null,
			providerId: null,
			populatedAt: null,
			properties: { exact: true },
			userId: UserId.make("user-id"),
			id: EntityId.make("archived-id"),
			createdAt: new Date("2024-01-01T00:00:00.000Z"),
			updatedAt: new Date("2025-01-01T00:00:00.000Z"),
			entitySchemaSlug: EntitySchemaSlug.make("record"),
		};

		return Effect.gen(function* () {
			const persistence = yield* BackupRestorePersistence;
			expect(yield* persistence.restoreEntity(input)).toBe(input.id);
			expect(yield* recordedEntries).toEqual([input]);
		});
	});
});

const eventStreamRepositoriesLayer = Layer.mergeAll(
	EntitiesRepository.layer.pipe(
		Layer.provide(Layer.mergeAll(Layer.mock(DefinitionRepository)({}), makePluginRuntime())),
	),
	EventsRepository.layer,
	EventStreamRepository.layer,
).pipe(Layer.provideMerge(isolatedDatabaseLayer("entities_repository_stream_invalidation")));

layer(eventStreamRepositoriesLayer)((test) => {
	test.effect("lists distinct event schema and reference-role dependencies", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EntitiesRepository;
			const userId = UserId.make("dependency-owner");
			const entityId = EntityId.make("dependency-entity");
			const occurredAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"));
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: userId, name: "Dependency owner", email: "dependency@example.test" }),
			);
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values({ id: entityId, name: "Entity", entitySchemaSlug: "record" }),
			);
			yield* session.run((db) =>
				db.execute(sql`
					insert into event (
						id,
						user_id,
						entity_id,
						session_entity_id,
						event_schema_slug,
						event_schema_plugin_id,
						occurred_at
					) values
						('dependency-entity-1', ${userId}, ${entityId}, ${entityId}, 'workout-set', null, ${occurredAt}),
						('dependency-entity-2', ${userId}, ${entityId}, null, 'workout-set', null, ${occurredAt})
				`),
			);

			expect(yield* repository.listEventDependencies(entityId)).toEqual([
				{
					role: "entity",
					eventSchemaPluginId: null,
					eventSchemaSlug: EventSchemaSlug.make("workout-set"),
				},
				{
					role: "session",
					eventSchemaPluginId: null,
					eventSchemaSlug: EventSchemaSlug.make("workout-set"),
				},
			]);
		}),
	);

	test.effect("invalidates event streams only after entity stream data changes", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EntitiesRepository;
			const events = yield* EventsRepository;
			const streams = yield* EventStreamRepository;
			const userId = UserId.make("stream-owner");
			const entityId = EntityId.make("stream-entity");
			const key = {
				userId,
				entityId,
				eventSchemaPluginId: null,
				eventSchemaSlug: EventSchemaSlug.make("progress"),
			};
			const occurredAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"));
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: userId, name: "Stream owner", email: "stream-owner@example.test" }),
			);
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values({ id: entityId, name: "Before", entitySchemaSlug: "record" }),
			);

			const event = {
				userId,
				entityId,
				occurredAt,
				properties: { value: 1 },
				eventSchemaPluginId: null,
				eventSchemaName: "Progress",
				id: EventId.make("stream-event"),
				eventSchemaSlug: key.eventSchemaSlug,
			};
			expect(yield* session.isTransactionActive).toBe(false);
			expect(yield* Effect.flip(events.createEvent(event))).toMatchObject({
				_tag: "DbError",
				message: "Event writes require an active transaction",
			});
			const created = yield* session.transaction(
				Effect.gen(function* () {
					expect(yield* session.isTransactionActive).toBe(true);
					return yield* events.createEvent(event);
				}),
			);
			expect(created.id).toBe(event.id);
			const streamId = yield* session.transaction(
				streams.request({
					key,
					outputProperties: ["value"],
					accountToken: "stream-account",
					pluginRevisionId: "stream-revision",
					processorScriptId: "stream-processor",
					pluginPin: { revisionId: "stream-revision" },
				}),
			);
			const beforeUpdate = yield* streams.get(streamId);
			assert(beforeUpdate);
			expect(beforeUpdate.streamRevision).toBe(1);
			yield* session.transaction(events.createEvent(event));
			expect((yield* streams.get(streamId))?.streamRevision).toBe(beforeUpdate.streamRevision);

			const claim = yield* session.transaction(streams.claim(streamId, 0));
			assert(claim);
			yield* session.transaction(streams.finish(streamId, claim.attempt, { cursor: "done" }, true));
			yield* session.transaction(
				Effect.gen(function* () {
					expect(yield* session.isTransactionActive).toBe(true);
					yield* repository.updateEntity({
						entityId,
						name: "After",
						populatedAt: null,
						properties: { value: 2 },
					});
				}),
			);
			const invalidated = yield* streams.get(streamId);
			assert(invalidated);
			expect(invalidated.streamRevision).toBe(beforeUpdate.streamRevision + 1);
			expect(invalidated.status).toBe("queued");

			yield* session.transaction(
				repository.updateEntity({
					entityId,
					name: "After",
					populatedAt: occurredAt,
					properties: { value: 2 },
				}),
			);
			expect((yield* streams.get(streamId))?.streamRevision).toBe(invalidated.streamRevision);
		}),
	);
});

const portableRow = {
	name: "Entity",
	properties: {},
	id: "entity-id",
	externalId: null,
	pluginSlug: null,
	populatedAt: null,
	providerSlug: null,
	providerPluginId: null,
	entitySchemaSlug: "entity",
	entitySchemaPluginId: null,
	createdAt: new Date("2024-01-01T00:00:00.000Z"),
	updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};
const portableQuery = {
	where: () => portableQuery,
	leftJoin: () => portableQuery,
	orderBy: () => Effect.succeed([portableRow]),
};

layer(repositoryWithDatabase({ select: () => ({ from: () => portableQuery }) }))((test) => {
	test.effect("lists portable entity provenance", () =>
		Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const row = portableRow;
			expect(yield* repository.listUserEntitiesForBackup(UserId.make("user-id"))).toEqual([
				{
					id: row.id,
					name: row.name,
					provider: null,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
					properties: row.properties,
					externalId: row.externalId,
					populatedAt: row.populatedAt,
					entitySchemaSlug: row.entitySchemaSlug,
					entitySchemaPluginId: row.entitySchemaPluginId,
				},
			]);
		}),
	);
});

layer(
	recordingLayer(repositoryWithDatabase, (record) => {
		const builder = {
			leftJoin: () => builder,
			where: (condition: { getSQL: () => Statement }) => ({
				limit: () =>
					record(dialect.sqlToQuery(condition.getSQL()).params).pipe(
						Effect.as([{ id: "existing-global", entitySchemaSlug: "record" }]),
					),
			}),
		};
		return { select: () => ({ from: () => builder }) };
	}),
)((test) => {
	test.effect(
		"resolves restore globals by portable schema, plugin, provider, and external IDs",
		() =>
			Effect.gen(function* () {
				const repository = yield* EntitiesRepository;
				expect(
					yield* repository.findGlobalEntityForRestore({
						externalId: "external-id",
						entitySchemaPluginId: null,
						entitySchemaSlug: EntitySchemaSlug.make("record"),
						provider: { pluginSlug: "example", providerSlug: "open-library" },
					}),
				).toEqual({ id: "existing-global", entitySchemaSlug: "record" });
				const [params] = yield* recordedEntries;
				expect(params).toEqual(
					expect.arrayContaining(["external-id", "record", "example", "open-library"]),
				);
				expect(params).not.toContain("archived-provider-db-id");
			}),
	);
});
