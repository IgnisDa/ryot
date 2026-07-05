import { expect, it } from "@effect/vitest";
import { EntitySchemaSlug, SandboxProviderId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";
import type { MockOverrides } from "#lib/test-utils/effect";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntitiesRepository } from "./repository";

const mockPluginRuntime = Layer.mock(PluginRuntimeResolver);

const makePluginRuntime = (overrides: MockOverrides<typeof mockPluginRuntime> = {}) =>
	mockPluginRuntime({ _tag: "PluginRuntimeResolver", ...overrides });

const makeLayer = (db: object, pluginRuntime = makePluginRuntime()) =>
	Layer.mergeAll(
		EntitiesRepository.Default.pipe(
			Layer.provide(Layer.mergeAll(DefinitionRegistry.Default, pluginRuntime)),
		),
		Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
	);

const makeDb = () => {
	let row: Record<string, unknown> | undefined;
	let forUpdateCalls = 0;
	const insert = () => ({
		values: (values: Record<string, unknown>) => ({
			onConflictDoNothing: () => ({
				returning: () => {
					if (row) {
						return Promise.resolve([]);
					}

					row = {
						...values,
						id: "entity-1",
						createdAt: new Date("2026-07-20T00:00:00.000Z"),
						updatedAt: new Date("2026-07-20T00:00:00.000Z"),
					};
					return Promise.resolve([row]);
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
						return Promise.resolve(row ? [row] : []);
					},
				}),
			}),
		}),
	});

	return { db: { insert, select }, getForUpdateCalls: () => forUpdateCalls };
};

it.effect("resolves provider identity and its active details executable", () => {
	const providerId = SandboxProviderId.make("provider-1");
	const detailsScriptId = SandboxScriptId.make("details-script-1");
	const pluginRuntime = makePluginRuntime({
		findDetailsScript: () =>
			Effect.succeed({
				providerId,
				name: "Details",
				source: "source",
				compiledFormat: 1,
				id: detailsScriptId,
				pluginSlug: "fixture",
				slug: "fixture.details",
				compiledCode: "compiled",
				contentHash: "details-hash",
				createdAt: new Date(0),
				updatedAt: new Date(0),
				metadata: { kind: "provider" as const },
			}),
		findSchemaProviderBySlug: () =>
			Effect.succeed({
				entitySchemaSlug: EntitySchemaSlug.make("person"),
				provider: {
					id: providerId,
					name: "Fixture",
					pluginSlug: "fixture",
					slug: "fixture-provider",
					createdAt: new Date(0),
					updatedAt: new Date(0),
					information: { source: "fixture" },
				},
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

it.effect("distinguishes an insert from a locked conflict row", () => {
	const { db, getForUpdateCalls } = makeDb();
	const layer = makeLayer(db);
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
		execute: (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
			const query = dialect.sqlToQuery(statement);
			executed.push(`${query.sql}:${query.params.join(":")}`);
			return Promise.resolve(undefined);
		},
		select: () => ({
			from: () => ({
				where: () => Promise.resolve([{ count: 7 }]),
			}),
		}),
	};

	return Effect.gen(function* () {
		const repository = yield* EntitiesRepository;
		const input = {
			providerId: SandboxProviderId.make("provider-1"),
			entitySchemaSlug: EntitySchemaSlug.make("person"),
		};
		yield* repository.lockGlobalEntityProvenanceScope(input);
		const total = yield* repository.countGlobalEntitiesByProvenanceScope(input);

		expect(total).toBe(7);
		expect(executed).toHaveLength(1);
		expect(executed[0]).toContain("pg_advisory_xact_lock");
		expect(executed[0]).toContain("global-entities:person:provider-1");
	}).pipe(Effect.provide(makeLayer(db)));
});
