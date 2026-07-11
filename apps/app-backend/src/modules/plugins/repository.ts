import { DbError } from "@ryot/contract/errors";
import { and, eq, inArray, isNull, notExists, notInArray, or, sql } from "drizzle-orm";
import { Effect } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import type { NormalizedPlugin, NormalizedPluginScript, StoredPlugin } from "./types";

type PluginRow = typeof schema.plugin.$inferSelect;
type ScriptRow = typeof schema.sandboxScript.$inferSelect;

type PersistedScript = Omit<NormalizedPluginScript, "entry">;

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
			contentHash,
			slug: stored.slug,
			name: stored.name,
			source: stored.source,
			compiledCode: stored.compiledCode,
			compiledFormat: stored.compiledFormat,
			metadata,
		});
	}
	return {
		status: row.status,
		manifest: row.manifest,
		scripts: currentScripts,
		sourceHash: row.sourceHash,
	} satisfies StoredPlugin;
});

export class PluginRepository extends Effect.Service<PluginRepository>()("PluginRepository", {
	sync: () => {
		const lockIngestion = Effect.fn("PluginRepository.lockIngestion")(function* () {
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db.execute(
					sql`select pg_advisory_xact_lock(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
				),
			);
		});

		const loadScripts = Effect.fn(function* (rows: ReadonlyArray<PluginRow>) {
			if (rows.length === 0) {
				return [];
			}
			const db = yield* CurrentDb;
			const pluginSlugs = rows.map(({ slug }) => slug);
			return yield* dbEffect(() =>
				db
					.select()
					.from(schema.sandboxScript)
					.where(inArray(schema.sandboxScript.pluginSlug, pluginSlugs)),
			);
		});

		const list = Effect.fn("PluginRepository.list")(function* () {
			const db = yield* CurrentDb;
			const rows = yield* dbEffect(() =>
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

		const hasEntityReferences = Effect.fn("PluginRepository.hasEntityReferences")(
			function* (input: { pluginSlug: string; entitySchemaSlugs: ReadonlyArray<string> }) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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

		const findBySourceHash = Effect.fn("PluginRepository.findBySourceHash")(function* (input: {
			slug: string;
			sourceHash: string;
		}) {
			const db = yield* CurrentDb;
			const [row] = yield* dbEffect(() =>
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
			const db = yield* CurrentDb;
			const [existing] = yield* dbEffect(() =>
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
				yield* dbEffect(() =>
					db
						.update(schema.sandboxScript)
						.set({ updatedAt: sql`now()` })
						.where(eq(schema.sandboxScript.id, existing.id)),
				);
				return;
			}
			yield* dbEffect(() =>
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
			const db = yield* CurrentDb;
			const slug = plugin.manifest.metadata.slug;
			const compiledHashes = Object.fromEntries(
				plugin.scripts.map((script) => [script.slug, script.contentHash]),
			);
			yield* dbEffect(() =>
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
					? yield* dbEffect(() =>
							db
								.insert(schema.sandboxProvider)
								.values(
									plugin.manifest.providers.map((provider) => ({
										slug: provider.slug,
										name: provider.name,
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
									},
								})
								.returning({ id: schema.sandboxProvider.id, slug: schema.sandboxProvider.slug }),
						)
					: [];
			const providerIdBySlug = new Map(providers.map((provider) => [provider.slug, provider.id]));
			if (plugin.scripts.length > 0) {
				yield* Effect.forEach(
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
						return dbEffect(() =>
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
								}),
						);
					},
					{ discard: true },
				);
			}
		});

		const deactivate = Effect.fn("PluginRepository.deactivate")(function* (slug: string) {
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db.update(schema.plugin).set({ status: "inactive" }).where(eq(schema.plugin.slug, slug)),
			);
		});

		const deleteUnreferencedScripts = Effect.fn("PluginRepository.deleteUnreferencedScripts")(
			function* (liveContentHashes: ReadonlySet<string>) {
				const db = yield* CurrentDb;
				return yield* dbEffect(() =>
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

		return {
			list,
			persist,
			deactivate,
			lockIngestion,
			findBySourceHash,
			hasEntityReferences,
			persistKernelScript,
			deleteUnreferencedScripts,
		};
	},
}) {}
