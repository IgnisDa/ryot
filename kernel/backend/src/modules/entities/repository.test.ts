import { assert, expect, layer } from "@effect/vitest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { eq, inArray } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, DateTime, Effect, Layer, Ref } from "effect";
import { chunksOf } from "effect/Array";

import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { restorePersistenceWithDatabase } from "#modules/backups/restore/persistence.test-support";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EventsRepository } from "#modules/events/repository";
import { EventStreamRepository } from "#modules/events/stream-repository";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { fakeDatabaseSession } from "#testing/effect";
import type { MockOverrides } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { EntitiesRepository, provenanceScopeKey, STATEMENT_CHUNK_SIZE } from "./repository";

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

const providerId = SandboxProviderId.make("provider-1");
const detailsScriptId = SandboxScriptId.make("details-script-1");

layer(
	repositoryWithDatabase(
		{},
		makePluginRuntime({
			findSchemaProviderByReference: () =>
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
					metadata: { runtimeImports: [], kind: "provider" as const },
				}),
		}),
	),
)((test) => {
	test.effect("resolves provider identity and its active details executable", () =>
		Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const resolved = yield* repository.findEntitySchemaProviderByReference({
				slug: "fixture-provider",
				owner: definitionOwner("fixture"),
			});

			expect(resolved).toEqual({
				providerId,
				detailsScriptId,
				entitySchemaSlug: EntitySchemaSlug.make("person"),
			});
		}),
	);
});

const dialect = new PgDialect();
type Statement = Parameters<typeof dialect.sqlToQuery>[0];

layer(
	recordingLayer(repositoryWithDatabase, (record) => ({
		execute: (statement: Statement) => {
			const query = dialect.sqlToQuery(statement);
			return record({ sql: query.sql, params: query.params });
		},
		select: () => ({
			from: () => ({
				where: () => ({
					groupBy: () =>
						Effect.succeed([
							{
								count: 7,
								providerId: "provider-1",
								entitySchemaSlug: "person",
								entitySchemaPluginId: "plugin-1",
							},
							{
								count: 3,
								providerId: "provider-1",
								entitySchemaSlug: "person",
								entitySchemaPluginId: null,
							},
						]),
				}),
			}),
		}),
	})),
)((test) => {
	test.effect(
		"locks every global provenance scope in one sorted statement and counts each scope",
		() =>
			Effect.gen(function* () {
				const repository = yield* EntitiesRepository;
				const plugin = {
					entitySchemaPluginId: "plugin-1",
					providerId: SandboxProviderId.make("provider-1"),
					entitySchemaSlug: EntitySchemaSlug.make("person"),
				};
				const kernel = { ...plugin, entitySchemaPluginId: null };
				yield* repository.lockGlobalEntityProvenanceScopes([plugin, kernel, plugin]);
				const totals = yield* repository.countGlobalEntitiesByProvenanceScopes([plugin, kernel]);

				const executed = yield* recordedEntries;
				expect(executed).toEqual([
					{
						sql: expect.stringContaining("with ordinality"),
						params: [
							'["global-entities","plugin-1","person","provider-1"]',
							'["global-entities",null,"person","provider-1"]',
						],
					},
				]);
				expect(totals.get(provenanceScopeKey(plugin))).toBe(7);
				expect(totals.get(provenanceScopeKey(kernel))).toBe(3);
			}),
	);
});

layer(
	recordingLayer(repositoryWithDatabase, (record) => ({
		execute: (statement: Statement) => record(dialect.sqlToQuery(statement).params),
	})),
)((test) => {
	test.effect("locks provider entity identities in canonical order", () =>
		Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const common = {
				scope: "global" as const,
				entitySchemaPluginId: "plugin-1",
				providerId: SandboxProviderId.make("provider-1"),
				entitySchemaSlug: EntitySchemaSlug.make("person"),
			};
			const inputs = [
				{ ...common, externalId: "zeta" },
				{ ...common, externalId: "alpha" },
				{ ...common, externalId: "Alpha" },
				{ ...common, externalId: "zeta" },
			];
			yield* repository.lockProviderEntityMutations(inputs);
			yield* repository.lockProviderEntityMutations(inputs.toReversed());

			expect(yield* recordedEntries).toEqual([
				[
					'["provider-entity","global","global","plugin-1","person","provider-1","Alpha"]',
					'["provider-entity","global","global","plugin-1","person","provider-1","alpha"]',
					'["provider-entity","global","global","plugin-1","person","provider-1","zeta"]',
				],
				[
					'["provider-entity","global","global","plugin-1","person","provider-1","Alpha"]',
					'["provider-entity","global","global","plugin-1","person","provider-1","alpha"]',
					'["provider-entity","global","global","plugin-1","person","provider-1","zeta"]',
				],
			]);
		}),
	);
});

const lockRecordingLayer = () =>
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
	}));

layer(lockRecordingLayer())((test) => {
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

layer(lockRecordingLayer())((test) => {
	test.effect("locks references beyond the bind limit in globally sorted chunks", () =>
		Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const ids = Array.from({ length: 32_768 }, (_, index) =>
				EntityId.make(`entity-${String(index).padStart(5, "0")}`),
			);
			yield* repository.lockEntityReferencesByIds(ids.toReversed());

			expect(yield* recordedEntries).toEqual(
				chunksOf(ids, STATEMENT_CHUNK_SIZE).map((predicateParams) => ({
					ordered: true,
					predicateParams,
					strength: "key share",
				})),
			);
		}),
	);
});

layer(
	recordingLayer(repositoryWithDatabase, (record) => ({
		select: () => ({
			from: () => ({
				where: (condition: { getSQL: () => Statement }) => ({
					groupBy: () =>
						record(dialect.sqlToQuery(condition.getSQL()).params.length).pipe(Effect.as([])),
				}),
			}),
		}),
	})),
)((test) => {
	test.effect("counts unique provenance scopes beyond the bind limit in bounded statements", () =>
		Effect.gen(function* () {
			const repository = yield* EntitiesRepository;
			const scopes = Array.from({ length: 12_000 }, (_, index) => ({
				entitySchemaPluginId: "plugin-1",
				entitySchemaSlug: EntitySchemaSlug.make("person"),
				providerId: SandboxProviderId.make(`provider-${index}`),
			}));
			yield* repository.countGlobalEntitiesByProvenanceScopes([...scopes, ...scopes]);

			expect(yield* recordedEntries).toEqual(
				chunksOf(scopes, STATEMENT_CHUNK_SIZE).map(() => STATEMENT_CHUNK_SIZE * 3),
			);
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
					accountToken: "stream-account",
					pluginRevisionId: "stream-revision",
					processorScriptId: "stream-processor",
					pluginPin: { revisionId: "stream-revision" },
					outputSchema: {
						unknownKeys: "strict" as const,
						fields: { value: { label: "value", description: "value", type: "number" as const } },
					},
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

layer(eventStreamRepositoriesLayer)((test) => {
	test.effect("stamps related population without touching populated_at", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EntitiesRepository;
			const entityId = EntityId.make("related-stamp-entity");
			const stampedAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"));
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values({ id: entityId, name: "Related", entitySchemaSlug: "record" }),
			);

			yield* session.transaction(repository.stampRelatedPopulated(entityId, stampedAt));

			const [row] = yield* session.run((db) =>
				db
					.select({
						populatedAt: tables.entity.populatedAt,
						relatedPopulatedAt: tables.entity.relatedPopulatedAt,
					})
					.from(tables.entity)
					.where(eq(tables.entity.id, entityId)),
			);
			expect(row).toEqual({ populatedAt: null, relatedPopulatedAt: stampedAt });
		}),
	);
});

const portableRow = {
	name: "Entity",
	properties: {},
	id: "entity-id",
	externalId: null,
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
						Effect.as([
							{
								id: "existing-global",
								entitySchemaSlug: "record",
								entitySchemaPluginId: "example",
							},
						]),
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
						entitySchemaPluginId: "example",
						entitySchemaSlug: EntitySchemaSlug.make("record"),
						provider: { slug: "open-library", owner: definitionOwner("example") },
					}),
				).toEqual({
					id: "existing-global",
					entitySchemaSlug: "record",
					entitySchemaPluginId: "example",
				});
				const [params] = yield* recordedEntries;
				expect(params).toEqual(
					expect.arrayContaining(["external-id", "record", "example", "open-library"]),
				);
				expect(params).not.toContain("archived-provider-db-id");
			}),
	);
});

layer(
	EntitiesRepository.layer.pipe(
		Layer.provide(Layer.mergeAll(Layer.mock(DefinitionRepository)({}), makePluginRuntime())),
		Layer.provideMerge(isolatedDatabaseLayer("entities_repository_user_batch_reads")),
	),
)((test) => {
	test.effect("reads only entities visible to the user in a batch", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EntitiesRepository;
			const owner = UserId.make("batch-owner");
			const other = UserId.make("batch-other");
			yield* session.run((db) =>
				db.insert(tables.user).values([
					{ id: owner, name: "Owner", email: "batch-owner@example.test" },
					{ id: other, name: "Other", email: "batch-other@example.test" },
				]),
			);
			yield* session.run((db) =>
				db.insert(tables.entity).values([
					{ id: "owned", name: "Owned", userId: owner, entitySchemaSlug: "record" },
					{ id: "foreign", userId: other, name: "Foreign", entitySchemaSlug: "record" },
					{ id: "global", name: "Global", entitySchemaSlug: "record" },
				]),
			);
			const found = yield* repository.getByIdsForUser({
				userId: owner,
				entityIds: ["missing", "foreign", "global", "owned", "owned"].map((id) =>
					EntityId.make(id),
				),
			});
			expect([...found.keys()].sort()).toEqual(["global", "owned"]);
			expect(found.get(EntityId.make("owned"))).toMatchObject({ name: "Owned", properties: {} });
		}),
	);
});

layer(eventStreamRepositoriesLayer)((test) => {
	test.effect("keeps a non-null populated_at only for flagged population root updates", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EntitiesRepository;
			const populatedAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"));
			const later = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-02T00:00:00.000Z"));
			const plain = EntityId.make("plain-update-entity");
			const flagged = EntityId.make("flagged-update-entity");
			const unpopulated = EntityId.make("flagged-unpopulated-entity");
			yield* session.run((db) =>
				db.insert(tables.entity).values([
					{ id: plain, populatedAt, name: "Plain", entitySchemaSlug: "record" },
					{ populatedAt, id: flagged, name: "Flagged", entitySchemaSlug: "record" },
					{ id: unpopulated, name: "Unpopulated", entitySchemaSlug: "record" },
				]),
			);
			const update = (entityId: EntityId, value: Date | null, preservePopulatedAt?: true) =>
				session.transaction(
					repository.updateEntity({
						entityId,
						properties: {},
						name: "Updated",
						populatedAt: value,
						...(preservePopulatedAt ? { preservePopulatedAt } : {}),
					}),
				);
			const populatedAtOf = (entityId: EntityId) =>
				session
					.run((db) =>
						db
							.select({ populatedAt: tables.entity.populatedAt })
							.from(tables.entity)
							.where(eq(tables.entity.id, entityId)),
					)
					.pipe(Effect.map(([row]) => row?.populatedAt));

			expect((yield* update(plain, null)).populatedAt).toBeNull();
			expect(yield* populatedAtOf(plain)).toBeNull();
			expect((yield* update(flagged, null, true)).populatedAt).toBe(populatedAt.toISOString());
			expect(yield* populatedAtOf(flagged)).toEqual(populatedAt);
			yield* update(flagged, later, true);
			expect(yield* populatedAtOf(flagged)).toEqual(later);
			yield* update(unpopulated, null, true);
			expect(yield* populatedAtOf(unpopulated)).toBeNull();
		}),
	);

	test.effect("clears related failures on the related stamp and stamps children once", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* EntitiesRepository;
			const populatedAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"));
			const earlier = DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-01T00:00:00.000Z"));
			const root = EntityId.make("related-failed-root");
			const child = EntityId.make("related-child");
			const stampedChild = EntityId.make("related-stamped-child");
			const unpopulatedChild = EntityId.make("related-unpopulated-child");
			yield* session.run((db) =>
				db.insert(tables.entity).values([
					{
						id: root,
						populatedAt,
						name: "Root",
						entitySchemaSlug: "record",
						relatedPopulationFailedAt: populatedAt,
						relatedPopulationFailure: "invalid-output",
					},
					{ id: child, populatedAt, name: "Child", entitySchemaSlug: "record" },
					{
						populatedAt,
						name: "Stamped",
						id: stampedChild,
						entitySchemaSlug: "record",
						relatedPopulatedAt: earlier,
					},
					{ name: "Unpopulated", id: unpopulatedChild, entitySchemaSlug: "record" },
				]),
			);

			yield* session.transaction(
				Effect.all([
					repository.stampRelatedPopulated(root, populatedAt),
					repository.stampChildRelatedPopulated([child, stampedChild, child, unpopulatedChild]),
				]),
			);

			const rows = yield* session.run((db) =>
				db
					.select({
						id: tables.entity.id,
						relatedPopulatedAt: tables.entity.relatedPopulatedAt,
						relatedPopulationFailure: tables.entity.relatedPopulationFailure,
						relatedPopulationFailedAt: tables.entity.relatedPopulationFailedAt,
					})
					.from(tables.entity)
					.where(inArray(tables.entity.id, [root, child, stampedChild, unpopulatedChild])),
			);
			const byId = new Map(rows.map((row) => [row.id, row]));
			expect(byId.get(root)).toMatchObject({
				relatedPopulationFailure: null,
				relatedPopulatedAt: populatedAt,
				relatedPopulationFailedAt: null,
			});
			expect(byId.get(child)?.relatedPopulatedAt).toEqual(populatedAt);
			expect(byId.get(stampedChild)?.relatedPopulatedAt).toEqual(earlier);
			expect(byId.get(unpopulatedChild)?.relatedPopulatedAt).toBeNull();
		}),
	);
});
