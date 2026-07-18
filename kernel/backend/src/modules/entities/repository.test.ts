import { expect, it } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import type { MockOverrides } from "#lib/test-utils/effect";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntitiesRepository } from "./repository";

const mockPluginRuntime = Layer.mock(PluginRuntimeResolver);

const makePluginRuntime = (overrides: MockOverrides<typeof mockPluginRuntime> = {}) =>
	mockPluginRuntime({ ...overrides });

const makeLayer = (db: object, pluginRuntime = makePluginRuntime()) =>
	Layer.mergeAll(
		EntitiesRepository.layer.pipe(
			Layer.provide(Layer.mergeAll(DefinitionRegistry.layer, pluginRuntime)),
		),
		Layer.succeed(Database, Object.assign(Object.create(null), db)),
	);

const makeDb = () => {
	const rows: Record<string, unknown>[] = [];
	let forUpdateCalls = 0;
	const insert = () => ({
		values: (values: Record<string, unknown>) => ({
			onConflictDoNothing: () => ({
				returning: () => {
					if (
						rows.some(
							(row) =>
								row["userId"] === values["userId"] &&
								row["externalId"] === values["externalId"] &&
								row["providerId"] === values["providerId"] &&
								row["entitySchemaSlug"] === values["entitySchemaSlug"] &&
								row["entitySchemaPluginId"] === values["entitySchemaPluginId"],
						)
					) {
						return Effect.succeed([]);
					}

					const row = {
						...values,
						id: `entity-${rows.length + 1}`,
						createdAt: new Date("2026-07-20T00:00:00.000Z"),
						updatedAt: new Date("2026-07-20T00:00:00.000Z"),
					};
					rows.push(row);
					return Effect.succeed([row]);
				},
			}),
		}),
	});
	const select = () => ({
		from: () => ({
			where: () => ({
				limit: () => ({
					for: () => {
						forUpdateCalls += 1;
						return Effect.succeed(rows.slice(0, 1));
					},
				}),
			}),
		}),
	});

	return { rows, db: { insert, select }, getForUpdateCalls: () => forUpdateCalls };
};

it.effect("resolves provider identity and its active details executable", () => {
	const providerId = SandboxProviderId.make("provider-1");
	const detailsScriptId = SandboxScriptId.make("details-script-1");
	const pluginRuntime = makePluginRuntime({
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
	});

	return Effect.gen(function* () {
		const repository = yield* EntitiesRepository;
		const resolved = yield* repository.findEntitySchemaProviderBySlug("fixture-provider");

		expect(resolved).toEqual({
			providerId,
			detailsScriptId,
			entitySchemaSlug: EntitySchemaSlug.make("person"),
		});
	}).pipe(Effect.provide(makeLayer({}, pluginRuntime)));
});

it.effect("keeps kernel and plugin entities with the same natural key separate", () => {
	const { db, rows } = makeDb();
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

		expect(rows.map(({ entitySchemaPluginId }) => entitySchemaPluginId)).toEqual([
			null,
			"plugin-1",
		]);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("distinguishes an insert from a locked conflict row", () => {
	const { db, getForUpdateCalls } = makeDb();
	const layer = makeLayer(db);
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
		expect(getForUpdateCalls()).toBe(1);
	}).pipe(Effect.provide(layer));
});

it.effect("locks and counts the complete global provenance scope", () => {
	const dialect = new PgDialect();
	const executed: string[] = [];
	const db = {
		select: () => ({ from: () => ({ where: () => Effect.succeed([{ count: 7 }]) }) }),
		execute: (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
			const query = dialect.sqlToQuery(statement);
			executed.push(`${query.sql}:${query.params.join(":")}`);
			return Effect.void;
		},
	};

	return Effect.gen(function* () {
		const repository = yield* EntitiesRepository;
		const input = {
			entitySchemaPluginId: "plugin-1",
			providerId: SandboxProviderId.make("provider-1"),
			entitySchemaSlug: EntitySchemaSlug.make("person"),
		};
		yield* repository.lockGlobalEntityProvenanceScope(input);
		const total = yield* repository.countGlobalEntitiesByProvenanceScope(input);

		expect(total).toBe(7);
		expect(executed).toHaveLength(1);
		expect(executed[0]).toContain("pg_advisory_xact_lock");
		expect(executed[0]).toContain("global-entities:person:plugin-1:provider-1");
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("locks provider entity identities in canonical order", () => {
	const dialect = new PgDialect();
	const keys: string[] = [];
	const db = {
		execute: (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
			const query = dialect.sqlToQuery(statement);
			keys.push(String(query.params[0]));
			return Effect.void;
		},
	};

	return Effect.gen(function* () {
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

		expect(keys).toEqual([
			'["provider-entity","global","global","person","provider-1","alpha"]',
			'["provider-entity","global","global","person","provider-1","zeta"]',
		]);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("locks unique entity references in canonical order", () => {
	const dialect = new PgDialect();
	let predicateParams: unknown[] = [];
	let ordered = false;
	let lockStrength: string | undefined;
	const query = {
		orderBy: (_column: unknown) => {
			ordered = true;
			return query;
		},
		for: (strength: string) => {
			lockStrength = strength;
			return Effect.succeed([]);
		},
		where: (condition: { getSQL: () => Parameters<typeof dialect.sqlToQuery>[0] }) => {
			predicateParams = dialect.sqlToQuery(condition.getSQL()).params;
			return query;
		},
	};
	const db = { select: () => ({ from: () => query }) };

	return Effect.gen(function* () {
		const repository = yield* EntitiesRepository;
		yield* repository.lockEntityReferencesByIds([
			EntityId.make("zeta"),
			EntityId.make("alpha"),
			EntityId.make("zeta"),
		]);

		expect(predicateParams).toEqual(["alpha", "zeta"]);
		expect(ordered).toBe(true);
		expect(lockStrength).toBe("key share");
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("restores an entity with its archived identity and timestamps", () => {
	let persisted: Record<string, unknown> | undefined;
	const db = {
		insert: () => ({
			values: (values: Record<string, unknown>) => ({
				returning: () => {
					persisted = values;
					return Effect.succeed([{ id: values["id"] }]);
				},
			}),
		}),
	};
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
		const repository = yield* EntitiesRepository;
		expect(yield* repository.restoreEntity(input)).toBe(input.id);
		expect(persisted).toEqual(input);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("lists portable entity provenance", () => {
	const row = {
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
	const query = { where: () => query, leftJoin: () => query, orderBy: () => Effect.succeed([row]) };
	const db = { select: () => ({ from: () => query }) };

	return Effect.gen(function* () {
		const repository = yield* EntitiesRepository;
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
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("resolves restore globals by portable schema, plugin, provider, and external IDs", () => {
	const dialect = new PgDialect();
	let predicate: { sql: string; params: unknown[] } | undefined;
	const builder = {
		leftJoin: () => builder,
		where: (condition: { getSQL: () => Parameters<typeof dialect.sqlToQuery>[0] }) => ({
			limit: () => {
				predicate = dialect.sqlToQuery(condition.getSQL());
				return Effect.succeed([{ id: "existing-global", entitySchemaSlug: "record" }]);
			},
		}),
	};
	const db = { select: () => ({ from: () => builder }) };

	return Effect.gen(function* () {
		const repository = yield* EntitiesRepository;
		expect(
			yield* repository.findGlobalEntityForRestore({
				externalId: "external-id",
				entitySchemaPluginId: null,
				entitySchemaSlug: EntitySchemaSlug.make("record"),
				provider: { pluginSlug: "example", providerSlug: "open-library" },
			}),
		).toEqual({ id: "existing-global", entitySchemaSlug: "record" });
		expect(predicate?.params).toEqual(
			expect.arrayContaining(["external-id", "record", "example", "open-library"]),
		);
		expect(predicate?.params).not.toContain("archived-provider-db-id");
	}).pipe(Effect.provide(makeLayer(db)));
});
