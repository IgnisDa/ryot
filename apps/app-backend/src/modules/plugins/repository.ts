import { DbError } from "@ryot/contract/errors";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";

import type { NormalizedPlugin, NormalizedPluginScript, StoredPlugin } from "./types";

type PluginRow = typeof schema.plugin.$inferSelect;
type ScriptRow = typeof schema.sandboxScript.$inferSelect;

const toStoredPlugin = Effect.fn(function* (row: PluginRow, scripts: ReadonlyArray<ScriptRow>) {
	const scriptsBySlugAndHash = new Map(
		scripts.map((script) => [`${script.slug}:${script.contentHash ?? ""}`, script]),
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

export class PluginRepository extends Effect.Service<PluginRepository>()("PluginRepository", {
	sync: () => {
		const lockIngestion = Effect.fn("PluginRepository.lockIngestion")(function* () {
			const db = yield* CurrentDb;
			yield* dbEffect(() =>
				db.execute(sql`select pg_advisory_xact_lock(hashtext('ryot-plugin-ingestion'))`),
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
						and(eq(schema.plugin.slug, input.slug), eq(schema.plugin.sourceHash, input.sourceHash)),
					)
					.limit(1),
			);
			if (!row) {
				return null;
			}
			const scripts = yield* loadScripts([row]);
			return yield* toStoredPlugin(row, scripts);
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
			if (plugin.scripts.length > 0) {
				yield* dbEffect(() =>
					db
						.insert(schema.sandboxScript)
						.values(
							plugin.scripts.map((script) => ({
								userId: null,
								isBuiltin: false,
								pluginSlug: slug,
								slug: script.slug,
								name: script.name,
								source: script.source,
								metadata: script.metadata,
								contentHash: script.contentHash,
								compiledCode: script.compiledCode,
								compiledFormat: script.compiledFormat,
							})),
						)
						.onConflictDoNothing({
							target: [
								schema.sandboxScript.pluginSlug,
								schema.sandboxScript.slug,
								schema.sandboxScript.contentHash,
							],
						}),
				);
			}
		});

		return { list, persist, lockIngestion, findBySourceHash };
	},
}) {}
