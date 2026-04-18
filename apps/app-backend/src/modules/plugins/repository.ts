import { DbError } from "@ryot/contract/errors";
import type { PluginProviderOperation } from "@ryot/contract/modules/plugins/manifest";
import { and, eq, inArray, isNull, notExists, notInArray, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import type { NormalizedPlugin, NormalizedPluginScript, StoredPlugin } from "./types";

type PluginRow = typeof schema.plugin.$inferSelect;
type ScriptRow = typeof schema.sandboxScript.$inferSelect;

type PersistedScript = Omit<NormalizedPluginScript, "entry">;

const toProviderOperation = (operation: string): PluginProviderOperation | undefined => {
	if (operation === "searchOptions") {
		return "search-options";
	}
	if (
		operation === "details" ||
		operation === "search" ||
		operation === "search-options" ||
		operation === "resolve" ||
		operation === "translate"
	) {
		return operation;
	}
	return undefined;
};

const toStoredPlugin = Effect.fn(function* (row: PluginRow, scripts: ReadonlyArray<ScriptRow>) {
	const scriptsBySlugAndHash = new Map(
		scripts.map((script) => [`${script.slug}:${script.contentHash}`, script]),
	);
	const currentScripts: Array<NormalizedPluginScript> = [];
	for (const script of row.manifest.scripts) {
		const contentHash = row.compiledHashes[script.slug];
		const stored = contentHash
			? scriptsBySlugAndHash.get(`${script.slug}:${contentHash}`)
			: undefined;
		if (!contentHash || !stored) {
			return yield* new DbError({
				message: `Plugin ${row.slug} is missing compiled script ${script.slug}`,
			});
		}
		const { entry, ...metadata } = script;
		currentScripts.push({
			entry,
			metadata,
			contentHash,
			slug: stored.slug,
			name: stored.name,
			source: stored.source,
			compiledCode: stored.compiledCode,
			compiledFormat: stored.compiledFormat,
		});
	}
	return {
		status: row.status,
		manifest: row.manifest,
		scripts: currentScripts,
		sourceHash: row.sourceHash,
	} satisfies StoredPlugin;
});

/** @effect-expect-leaking Database */
export class PluginRepository extends Context.Service<PluginRepository>()("PluginRepository", {
	make: Effect.sync(() => {
		const lockIngestion = Effect.fn("PluginRepository.lockIngestion")(function* () {
			const db = yield* Database;
			yield* mapDatabaseErrors(
				db.execute(
					sql`select pg_advisory_xact_lock(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
				),
			);
		});

		const loadScripts = Effect.fn(function* (rows: ReadonlyArray<PluginRow>) {
			if (rows.length === 0) {
				return [];
			}
			const db = yield* Database;
			const pluginSlugs = rows.map(({ slug }) => slug);
			return yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.sandboxScript)
					.where(inArray(schema.sandboxScript.pluginSlug, pluginSlugs)),
			);
		});

		const list = Effect.fn("PluginRepository.list")(function* () {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db.select().from(schema.plugin).where(eq(schema.plugin.status, "active")),
			);
			const scripts = yield* loadScripts(rows);
			return yield* Effect.forEach(rows, (row) =>
				toStoredPlugin(
					row,
					scripts.filter(({ pluginSlug }) => pluginSlug === row.slug),
				),
			);
		});

		const listActiveManifests = Effect.fn("PluginRepository.listActiveManifests")(function* () {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select({ manifest: schema.plugin.manifest })
					.from(schema.plugin)
					.where(eq(schema.plugin.status, "active")),
			);
			return rows.map(({ manifest }) => manifest);
		});

		const hasEntityReferences = Effect.fn("PluginRepository.hasEntityReferences")(
			function* (input: { pluginSlug: string; entitySchemaSlugs: ReadonlyArray<string> }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.entity.id })
						.from(schema.entity)
						.leftJoin(
							schema.sandboxProvider,
							eq(schema.entity.providerId, schema.sandboxProvider.id),
						)
						.where(
							input.entitySchemaSlugs.length > 0
								? or(
										inArray(schema.entity.entitySchemaSlug, [...input.entitySchemaSlugs]),
										eq(schema.sandboxProvider.pluginSlug, input.pluginSlug),
									)
								: eq(schema.sandboxProvider.pluginSlug, input.pluginSlug),
						)
						.limit(1),
				);
				return row !== undefined;
			},
		);

		const hasIntegrationReferences = Effect.fn("PluginRepository.hasIntegrationReferences")(
			function* (pluginSlug: string) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.integration.id })
						.from(schema.integration)
						.where(eq(schema.integration.pluginSlug, pluginSlug))
						.limit(1),
				);
				return row !== undefined;
			},
		);

		const findBySourceHash = Effect.fn("PluginRepository.findBySourceHash")(function* (input: {
			slug: string;
			sourceHash: string;
		}) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.plugin)
					.where(
						and(
							eq(schema.plugin.slug, input.slug),
							eq(schema.plugin.status, "active"),
							eq(schema.plugin.sourceHash, input.sourceHash),
						),
					)
					.limit(1),
			);
			if (!row) {
				return null;
			}
			const scripts = yield* loadScripts([row]);
			return yield* toStoredPlugin(row, scripts);
		});

		const persistKernelScript = Effect.fn("PluginRepository.persistKernelScript")(function* (
			script: PersistedScript,
		) {
			const db = yield* Database;
			const [existing] = yield* mapDatabaseErrors(
				db
					.select({ id: schema.sandboxScript.id })
					.from(schema.sandboxScript)
					.where(
						and(
							eq(schema.sandboxScript.slug, script.slug),
							eq(schema.sandboxScript.contentHash, script.contentHash),
							isNull(schema.sandboxScript.pluginSlug),
						),
					)
					.limit(1),
			);
			if (existing) {
				yield* mapDatabaseErrors(
					db
						.update(schema.sandboxScript)
						.set({ updatedAt: sql`now()` })
						.where(eq(schema.sandboxScript.id, existing.id)),
				);
				return;
			}
			yield* mapDatabaseErrors(
				db
					.insert(schema.sandboxScript)
					.values({
						pluginSlug: null,
						slug: script.slug,
						name: script.name,
						source: script.source,
						metadata: script.metadata,
						contentHash: script.contentHash,
						compiledCode: script.compiledCode,
						compiledFormat: script.compiledFormat,
					})
					.onConflictDoNothing(),
			);
		});

		const persist = Effect.fn("PluginRepository.persist")(function* (plugin: NormalizedPlugin) {
			const db = yield* Database;
			const slug = plugin.manifest.metadata.slug;
			const existingProviders = yield* mapDatabaseErrors(
				db
					.select({ id: schema.sandboxProvider.id, slug: schema.sandboxProvider.slug })
					.from(schema.sandboxProvider)
					.where(eq(schema.sandboxProvider.pluginSlug, slug)),
			);
			const compiledHashes = Object.fromEntries(
				plugin.scripts.map((script) => [script.slug, script.contentHash]),
			);
			yield* mapDatabaseErrors(
				db
					.insert(schema.plugin)
					.values({
						slug,
						compiledHashes,
						status: "active",
						manifest: plugin.manifest,
						sourceHash: plugin.sourceHash,
						version: plugin.manifest.metadata.version,
					})
					.onConflictDoUpdate({
						target: schema.plugin.slug,
						set: {
							compiledHashes,
							status: "active",
							ingestedAt: sql`now()`,
							manifest: plugin.manifest,
							sourceHash: plugin.sourceHash,
							version: plugin.manifest.metadata.version,
						},
					}),
			);
			const providers =
				plugin.manifest.providers.length > 0
					? yield* mapDatabaseErrors(
							db
								.insert(schema.sandboxProvider)
								.values(
									plugin.manifest.providers.map((provider) => ({
										slug: provider.slug,
										name: provider.name,
										rootEntitySchemaSlug: provider.rootEntitySchemaSlug,
										pluginSlug: slug,
										information: provider.information,
									})),
								)
								.onConflictDoUpdate({
									target: [schema.sandboxProvider.pluginSlug, schema.sandboxProvider.slug],
									set: {
										updatedAt: sql`now()`,
										name: sql`excluded.name`,
										information: sql`excluded.information`,
										rootEntitySchemaSlug: sql`excluded.root_entity_schema_slug`,
									},
								})
								.returning({ id: schema.sandboxProvider.id, slug: schema.sandboxProvider.slug }),
						)
					: [];
			const providerIdBySlug = new Map(providers.map((provider) => [provider.slug, provider.id]));
			const providerIds = new Map([
				...existingProviders.map((provider) => [provider.slug, provider.id] as const),
				...providers.map((provider) => [provider.slug, provider.id] as const),
			]);
			const declaredOperationsByProvider = new Map(
				plugin.manifest.providers.map((provider) => [
					provider.slug,
					new Set(
						Object.keys(provider.operations).flatMap((operation) => {
							const typedOperation = toProviderOperation(operation);
							return typedOperation ? [typedOperation] : [];
						}),
					),
				]),
			);
			yield* Effect.forEach(
				[...providerIds.entries()],
				([providerSlug, providerId]) => {
					const operations = declaredOperationsByProvider.get(providerSlug);
					return mapDatabaseErrors(
						db
							.delete(schema.sandboxProviderOperation)
							.where(
								and(
									eq(schema.sandboxProviderOperation.providerId, providerId),
									operations && operations.size > 0
										? notInArray(schema.sandboxProviderOperation.operation, [...operations])
										: undefined,
								),
							),
					);
				},
				{ discard: true },
			);
			if (plugin.scripts.length > 0) {
				const persistedScriptRows = yield* Effect.forEach(
					plugin.scripts,
					(script) => {
						const providerSlug =
							"providerSlug" in script.metadata ? script.metadata.providerSlug : undefined;
						const providerId = providerSlug ? providerIdBySlug.get(providerSlug) : undefined;
						if (providerSlug && !providerId) {
							return Effect.fail(
								new DbError({
									message: `Plugin ${slug} is missing provider ${providerSlug}`,
								}),
							);
						}
						return mapDatabaseErrors(
							db
								.insert(schema.sandboxScript)
								.values({
									providerId: providerId ?? null,
									pluginSlug: slug,
									slug: script.slug,
									name: script.name,
									source: script.source,
									metadata: script.metadata,
									contentHash: script.contentHash,
									compiledCode: script.compiledCode,
									compiledFormat: script.compiledFormat,
								})
								.onConflictDoUpdate({
									target: [
										schema.sandboxScript.pluginSlug,
										schema.sandboxScript.slug,
										schema.sandboxScript.contentHash,
									],
									set: {
										updatedAt: sql`now()`,
										providerId: providerId ?? null,
										metadata: script.metadata,
									},
								})
								.returning({
									id: schema.sandboxScript.id,
									slug: schema.sandboxScript.slug,
									contentHash: schema.sandboxScript.contentHash,
								}),
						);
					},
					{ discard: false },
				);
				const scriptIdBySlug = new Map<string, string>(
					persistedScriptRows
						.flatMap((rows) => rows)
						.map((script) => [script.slug, script.id] as const),
				);
				for (const provider of plugin.manifest.providers) {
					const providerId = providerIdBySlug.get(provider.slug);
					if (!providerId) {
						return yield* new DbError({
							message: `Plugin ${slug} is missing provider ${provider.slug}`,
						});
					}
					for (const [operation, scriptSlug] of Object.entries(provider.operations)) {
						const typedOperation = toProviderOperation(operation);
						if (!typedOperation) {
							return yield* new DbError({
								message: `Plugin ${slug} has an invalid provider operation ${provider.slug}:${operation}`,
							});
						}
						if (!scriptSlug) {
							return yield* new DbError({
								message: `Plugin ${slug} has no script for provider operation ${provider.slug}:${operation}`,
							});
						}
						const script = plugin.scripts.find((candidate) => candidate.slug === scriptSlug);
						const scriptId = scriptIdBySlug.get(scriptSlug);
						if (!script || !scriptId) {
							return yield* new DbError({
								message: `Plugin ${slug} has no persisted script for provider operation ${provider.slug}:${operation}`,
							});
						}
						const optionsSchema =
							typedOperation === "search" && "searchOptionsSchema" in script.metadata
								? (script.metadata.searchOptionsSchema ?? null)
								: null;
						yield* mapDatabaseErrors(
							db
								.insert(schema.sandboxProviderOperation)
								.values({ scriptId, providerId, optionsSchema, operation: typedOperation })
								.onConflictDoUpdate({
									set: { scriptId, optionsSchema, updatedAt: sql`now()` },
									target: [
										schema.sandboxProviderOperation.providerId,
										schema.sandboxProviderOperation.operation,
									],
								}),
						);
					}
				}
			}
			return yield* Effect.void;
		});

		const deactivate = Effect.fn("PluginRepository.deactivate")(function* (slug: string) {
			const db = yield* Database;
			yield* mapDatabaseErrors(
				db.update(schema.plugin).set({ status: "inactive" }).where(eq(schema.plugin.slug, slug)),
			);
		});

		const deleteUnreferencedScripts = Effect.fn("PluginRepository.deleteUnreferencedScripts")(
			function* (liveContentHashes: ReadonlySet<string>) {
				const db = yield* Database;
				yield* mapDatabaseErrors(
					db.delete(schema.sandboxProviderOperation).where(
						notExists(
							db
								.select({ id: schema.sandboxScript.id })
								.from(schema.sandboxScript)
								.where(
									and(
										eq(schema.sandboxScript.id, schema.sandboxProviderOperation.scriptId),
										liveContentHashes.size > 0
											? inArray(schema.sandboxScript.contentHash, [...liveContentHashes])
											: sql`false`,
									),
								),
						),
					),
				);
				return yield* mapDatabaseErrors(
					db
						.delete(schema.sandboxScript)
						.where(
							and(
								liveContentHashes.size > 0
									? notInArray(schema.sandboxScript.contentHash, [...liveContentHashes])
									: undefined,
								notExists(
									db
										.select({ scriptId: schema.sandboxWorkflowReference.scriptId })
										.from(schema.sandboxWorkflowReference)
										.where(eq(schema.sandboxWorkflowReference.scriptId, schema.sandboxScript.id)),
								),
							),
						)
						.returning({
							id: schema.sandboxScript.id,
							contentHash: schema.sandboxScript.contentHash,
						}),
				);
			},
		);

		const listPersistedLivenessContentHashes = Effect.fn(
			"PluginRepository.listPersistedLivenessContentHashes",
		)(function* (referencedPluginSlugs: ReadonlySet<string>) {
			const db = yield* Database;
			const pluginSlugs = [...referencedPluginSlugs];
			const rows = yield* mapDatabaseErrors(
				db
					.select({ contentHash: schema.sandboxScript.contentHash })
					.from(schema.sandboxScript)
					.where(
						pluginSlugs.length > 0
							? or(
									isNull(schema.sandboxScript.pluginSlug),
									inArray(schema.sandboxScript.pluginSlug, pluginSlugs),
								)
							: isNull(schema.sandboxScript.pluginSlug),
					),
			);
			return rows.map(({ contentHash }) => contentHash);
		});

		return {
			list,
			persist,
			deactivate,
			lockIngestion,
			findBySourceHash,
			listActiveManifests,
			persistKernelScript,
			hasEntityReferences,
			hasIntegrationReferences,
			deleteUnreferencedScripts,
			listPersistedLivenessContentHashes,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
