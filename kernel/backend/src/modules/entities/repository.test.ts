import { expect, layer } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref } from "effect";

import { fakeDatabaseSession } from "#lib/test-utils/effect";
import type { MockOverrides } from "#lib/test-utils/effect";
import { BackupRestorePersistence } from "#modules/backups/restore/persistence";
import { restorePersistenceWithDatabase } from "#modules/backups/restore/persistence.test-support";
import { DefinitionRepository } from "#modules/definition-registry/repository";
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
