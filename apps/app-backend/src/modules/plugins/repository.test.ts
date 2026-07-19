import { expect, it } from "@effect/vitest";
import { sql, type SQLWrapper } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb } from "#lib/infrastructure/db/service";

import { PluginRepository } from "./repository";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const makeLayer = (input: {
	statuses?: Array<string>;
	entityRows?: ReadonlyArray<{ id: string }>;
	integrationRows?: ReadonlyArray<{ id: string }>;
}) => {
	const db = {
		select: () => ({
			from: (table: unknown) => ({
				where: () => ({
					limit: () =>
						Promise.resolve(table === schema.integration ? (input.integrationRows ?? []) : []),
				}),
				leftJoin: () => ({
					where: () => ({ limit: () => Promise.resolve(input.entityRows ?? []) }),
				}),
			}),
		}),
		update: () => ({
			set: ({ status }: { status: string }) => ({
				where: () => {
					input.statuses?.push(status);
					return Promise.resolve();
				},
			}),
		}),
	};
	return PluginRepository.layer.pipe(
		Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
	);
};

const makeScriptCleanupLayer = (input: {
	tables: Array<unknown>;
	statements: Array<{ sql: string; params: unknown[] }>;
	removed: Array<ReadonlyArray<{ id: string; contentHash: string }>>;
}) => {
	const dialect = new PgDialect();
	const db = {
		delete: (table: unknown) => {
			input.tables.push(table);
			return {
				where: (condition: SQLWrapper) => {
					input.statements.push(dialect.sqlToQuery(condition.getSQL()));
					return Object.assign(Promise.resolve(), {
						returning: () => Promise.resolve(input.removed.shift() ?? []),
					});
				},
			};
		},
		select: () => ({
			from: (table: SQLWrapper) => ({
				where: (condition: SQLWrapper) => sql`select 1 from ${table} where ${condition}`,
			}),
		}),
	};
	return PluginRepository.layer.pipe(
		Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
	);
};

it.effect("detects entity references to plugin schema slugs", () =>
	Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(
			yield* repository.hasEntityReferences({
				pluginSlug: "fixture",
				entitySchemaSlugs: ["fixture-entity"],
			}),
		).toBe(true);
	}).pipe(Effect.provide(makeLayer({ entityRows: [{ id: "entity-id" }] }))),
);

it.effect("detects entities referencing a plugin provider", () =>
	Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(
			yield* repository.hasEntityReferences({
				pluginSlug: "fixture",
				entitySchemaSlugs: [],
			}),
		).toBe(true);
	}).pipe(Effect.provide(makeLayer({ entityRows: [{ id: "entity-id" }] }))),
);

it.effect("detects integrations owned by a plugin", () =>
	Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(yield* repository.hasIntegrationReferences("fixture")).toBe(true);
	}).pipe(Effect.provide(makeLayer({ integrationRows: [{ id: "integration-id" }] }))),
);

it.effect("loads active manifests without selecting plugin scripts", () => {
	const manifest = fixtureManifest();
	const selections: Array<unknown> = [];
	const tables: Array<unknown> = [];
	const db = {
		select: (selection: unknown) => {
			selections.push(selection);
			return {
				from: (table: unknown) => {
					tables.push(table);
					return { where: () => Promise.resolve([{ manifest }]) };
				},
			};
		},
	};
	const layer = PluginRepository.layer.pipe(
		Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
	);

	return Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(yield* repository.listActiveManifests()).toEqual([manifest]);
		expect(selections).toEqual([{ manifest: schema.plugin.manifest }]);
		expect(tables).toEqual([schema.plugin]);
	}).pipe(Effect.provide(layer));
});

it.effect(
	"preserves provider IDs and persists provider script membership across reingestion",
	() => {
		const scriptRows: Array<unknown> = [];
		const db = {
			delete: () => ({ where: () => Promise.resolve() }),
			select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
			insert: (table: unknown) => ({
				values: (values: unknown) => {
					if (table === schema.sandboxScript && typeof values === "object" && values !== null) {
						scriptRows.push(values);
					}
					return {
						onConflictDoUpdate: () => {
							if (table === schema.sandboxProvider) {
								return {
									returning: () =>
										Promise.resolve([{ id: "stable-provider-id", slug: "fixture-provider" }]),
								};
							}
							if (table === schema.sandboxScript) {
								const slug =
									typeof values === "object" && values !== null
										? Reflect.get(values, "slug")
										: undefined;
								const contentHash =
									typeof values === "object" && values !== null
										? Reflect.get(values, "contentHash")
										: undefined;
								return {
									returning: () =>
										Promise.resolve(
											typeof slug === "string" && typeof contentHash === "string"
												? [{ id: `${slug}-id`, slug, contentHash }]
												: [],
										),
								};
							}
							return Promise.resolve();
						},
					};
				},
			}),
		};
		const manifest = fixtureManifest();
		const automation = manifest.scripts[0];
		assert(automation);
		const providerScript = {
			...automation,
			name: "Fixture details",
			slug: "fixture.details",
			kind: "provider" as const,
			providerSlug: "fixture-provider",
			providerOperation: "details" as const,
		};
		const customScript = {
			...automation,
			kind: "script" as const,
			name: "Fixture preload",
			slug: "fixture.preload",
			providerSlug: "fixture-provider",
		};
		const plugin: NormalizedPlugin = {
			sourceHash: "source-hash",
			manifest: {
				...manifest,
				scripts: [...manifest.scripts, providerScript, customScript],
				providers: [
					{
						name: "Fixture provider",
						slug: "fixture-provider",
						information: { source: "fixture" },
						rootEntitySchemaSlug: "fixture-entity",
						operations: { details: providerScript.slug },
					},
				],
			},
			scripts: [automation, providerScript, customScript].map((script) => {
				const { entry, ...metadata } = script;
				return {
					entry,
					metadata,
					source: "source",
					compiledFormat: 1,
					slug: script.slug,
					name: script.name,
					compiledCode: "compiled",
					contentHash: `${script.slug}-hash`,
				};
			}),
		};
		const layer = PluginRepository.layer.pipe(
			Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
		);
		return Effect.gen(function* () {
			const repository = yield* PluginRepository;
			yield* repository.persist(plugin);
			yield* repository.persist({ ...plugin, sourceHash: "updated-source-hash" });
			expect(scriptRows).toEqual([
				expect.objectContaining({ providerId: null, slug: automation.slug }),
				expect.objectContaining({ providerId: "stable-provider-id", slug: providerScript.slug }),
				expect.objectContaining({ providerId: "stable-provider-id", slug: customScript.slug }),
				expect.objectContaining({ providerId: null, slug: automation.slug }),
				expect.objectContaining({ providerId: "stable-provider-id", slug: providerScript.slug }),
				expect.objectContaining({ providerId: "stable-provider-id", slug: customScript.slug }),
			]);
		}).pipe(Effect.provide(layer));
	},
);

it.effect("persists provider operation bindings and search options separately", () => {
	const operationValues: Array<unknown> = [];
	const db = {
		select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
		delete: () => ({ where: () => Promise.resolve() }),
		insert: (table: unknown) => ({
			values: (values: unknown) => {
				if (
					table === schema.sandboxProviderOperation &&
					typeof values === "object" &&
					values !== null
				) {
					operationValues.push(values);
				}
				return {
					onConflictDoUpdate: () => {
						if (table === schema.sandboxProvider) {
							return {
								returning: () => Promise.resolve([{ id: "provider-id", slug: "fixture-provider" }]),
							};
						}
						if (table === schema.sandboxScript) {
							return {
								returning: () =>
									Promise.resolve([
										{
											id: `${String(
												Reflect.get(
													typeof values === "object" && values !== null ? values : {},
													"slug",
												),
											)}-id`,
											slug: Reflect.get(
												typeof values === "object" && values !== null ? values : {},
												"slug",
											),
											contentHash: Reflect.get(
												typeof values === "object" && values !== null ? values : {},
												"contentHash",
											),
										},
									]),
							};
						}
						return Promise.resolve();
					},
				};
			},
		}),
	};
	const manifest = fixtureManifest();
	const automation = manifest.scripts[0];
	assert(automation);
	const details = {
		...automation,
		name: "Fixture details",
		slug: "fixture.details",
		kind: "provider" as const,
		providerSlug: "fixture-provider",
		providerOperation: "details" as const,
	};
	const searchOptionsSchema = {
		unknownKeys: "strict" as const,
		fields: {
			includeArchived: {
				type: "boolean" as const,
				label: "Include archived",
				description: "Include archived records",
			},
		},
	};
	const search = {
		...automation,
		name: "Fixture search",
		slug: "fixture.search",
		kind: "provider" as const,
		providerSlug: "fixture-provider",
		providerOperation: "search" as const,
		searchOptionsSchema,
	};
	const searchOptions = {
		...automation,
		kind: "provider" as const,
		name: "Fixture search options",
		slug: "fixture.search-options",
		providerSlug: "fixture-provider",
		providerOperation: "search-options" as const,
	};
	const normalized: NormalizedPlugin = {
		sourceHash: "source-hash",
		manifest: {
			...manifest,
			providers: [
				{
					name: "Fixture provider",
					slug: "fixture-provider",
					information: { source: "fixture" },
					rootEntitySchemaSlug: "fixture-entity",
					operations: {
						search: search.slug,
						details: details.slug,
						searchOptions: searchOptions.slug,
					},
				},
			],
			scripts: [...manifest.scripts, details, search, searchOptions],
		},
		scripts: [automation, details, search, searchOptions].map((script) => {
			const { entry, ...metadata } = script;
			return {
				entry,
				metadata,
				source: "source",
				compiledFormat: 1,
				slug: script.slug,
				name: script.name,
				compiledCode: "compiled",
				contentHash: `${script.slug}-hash`,
			};
		}),
	};
	const layer = PluginRepository.layer.pipe(
		Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
	);

	return Effect.gen(function* () {
		const repository = yield* PluginRepository;
		yield* repository.persist(normalized);
		expect(operationValues).toEqual([
			expect.objectContaining({
				operation: "details",
				optionsSchema: null,
				scriptId: "fixture.details-id",
			}),
			expect.objectContaining({
				operation: "search",
				scriptId: "fixture.search-id",
				optionsSchema: searchOptionsSchema,
			}),
			expect.objectContaining({
				optionsSchema: null,
				operation: "search-options",
				scriptId: "fixture.search-options-id",
			}),
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("deactivates a plugin without deleting its script rows", () => {
	const statuses: Array<string> = [];
	return Effect.gen(function* () {
		const repository = yield* PluginRepository;
		yield* repository.deactivate("fixture");
		expect(statuses).toEqual(["inactive"]);
	}).pipe(Effect.provide(makeLayer({ statuses })));
});

it.effect("deletes only non-live scripts while guarding exact workflow references", () => {
	const tables: Array<unknown> = [];
	const statements: Array<{ sql: string; params: unknown[] }> = [];
	const removed = [[{ id: "obsolete-script", contentHash: "obsolete-hash" }]];
	return Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(
			yield* repository.deleteUnreferencedScripts(new Set(["active-hash", "kernel-hash"])),
		).toEqual([{ id: "obsolete-script", contentHash: "obsolete-hash" }]);
		expect(tables).toEqual([schema.sandboxProviderOperation, schema.sandboxScript]);
		expect(statements[1]?.sql).toContain("not in");
		expect(statements[1]?.sql).toContain("not exists");
		expect(statements[1]?.sql).toContain('from "sandbox_workflow_reference"');
		expect(statements[1]?.params).toEqual(["active-hash", "kernel-hash"]);
	}).pipe(Effect.provide(makeScriptCleanupLayer({ removed, statements, tables })));
});

it.effect("safely deletes unreferenced scripts when the live hash set is empty", () => {
	const tables: Array<unknown> = [];
	const statements: Array<{ sql: string; params: unknown[] }> = [];
	const removed = [[{ id: "obsolete-script", contentHash: "obsolete-hash" }]];
	return Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(yield* repository.deleteUnreferencedScripts(new Set())).toEqual([
			{ id: "obsolete-script", contentHash: "obsolete-hash" },
		]);
		expect(statements[1]?.sql).not.toContain("not in");
		expect(statements[1]?.sql).toContain("not exists");
		expect(statements[1]?.params).toEqual([]);
	}).pipe(Effect.provide(makeScriptCleanupLayer({ removed, statements, tables })));
});

it.effect("lists persisted source-zero and pinned-plugin script hashes as live", () => {
	const statements: Array<{ sql: string; params: unknown[] }> = [];
	const dialect = new PgDialect();
	const db = {
		select: () => ({
			from: () => ({
				where: (condition: SQLWrapper) => {
					statements.push(dialect.sqlToQuery(condition.getSQL()));
					return Promise.resolve([
						{ contentHash: "kernel-history" },
						{ contentHash: "plugin-history" },
					]);
				},
			}),
		}),
	};
	const layer = PluginRepository.layer.pipe(
		Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
	);

	return Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(
			yield* repository.listPersistedLivenessContentHashes(new Set(["pinned-plugin"])),
		).toEqual(["kernel-history", "plugin-history"]);
		expect(statements[0]?.sql).toContain('"sandbox_script"."pluginSlug" is null');
		expect(statements[0]?.sql).toContain('"sandbox_script"."pluginSlug" in');
		expect(statements[0]?.params).toEqual(["pinned-plugin"]);
	}).pipe(Effect.provide(layer));
});
