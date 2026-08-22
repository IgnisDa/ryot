import type { PluginClientArtifact } from "@ryot-app/client-plugin-contract";
import { DbError } from "@ryot-app/contract/errors";
import {
	PluginManifest,
	type PluginProviderOperation,
} from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	and,
	asc,
	eq,
	exists,
	inArray,
	isNull,
	not,
	notExists,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import { Cache, Context, Duration, Effect, Exit, Layer, Option, Schema } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import type {
	PluginEnvironmentConfigEntry,
	PluginEnvironmentConfigSnapshot,
} from "#lib/infrastructure/plugin-environment-config";

import { PluginConfigRevisions } from "./config-revisions";
import { deepFreeze } from "./loader";
import { pluginPointerFields } from "./persisted-projections";
import type {
	NormalizedPlugin,
	NormalizedPluginScript,
	PluginPersistenceIdentity,
	PluginRevision,
	PluginScriptDescriptor,
	StoredPlugin,
	StoredPluginIdentity,
} from "./types";

type PluginPointerRow = typeof schema.plugin.$inferSelect;
type ClientArtifactRow = typeof schema.pluginClientArtifact.$inferSelect;
type ClientArtifactFileRow = typeof schema.pluginClientArtifactFile.$inferSelect;

type PersistedScript = Omit<NormalizedPluginScript, "entry">;

const retainedScriptExecution = (now: Date) => sql<boolean>`(exists (
	select 1 from ${schema.automationRun} r
	where r.sandbox_script_id = ${schema.sandboxScript.id}
	or (r.plugin_revision_id = ${schema.sandboxScript.pluginRevisionId}
		and (r.status in ('queued', 'running') or r.artifacts_expire_at > ${now}))
) or exists (
	select 1 from ${schema.sandboxWorkflowReference} w
	join ${schema.sandboxScript} pinned on pinned.id = w.script_id
	where w.script_id = ${schema.sandboxScript.id}
	or pinned.plugin_revision_id = ${schema.sandboxScript.pluginRevisionId}
))`;

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
	left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);

export const clientArtifactMatches = (
	artifact: PluginClientArtifact,
	metadata: ClientArtifactRow,
	files: ReadonlyArray<ClientArtifactFileRow>,
) =>
	metadata.hash === artifact.hash &&
	metadata.format === artifact.format &&
	metadata.apiVersion === artifact.apiVersion &&
	metadata.bridgeVersion === artifact.bridgeVersion &&
	metadata.compilerVersion === artifact.compilerVersion &&
	files.length === artifact.files.length &&
	artifact.files.every((file) =>
		files.some(
			(stored) =>
				stored.name === file.name &&
				bytesEqual(stored.contents, file.contents) &&
				stored.contentType === file.contentType,
		),
	);

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

type CachedPluginRevision = PluginRevision & {
	readonly id: string;
	readonly version: string;
	readonly pluginId: string;
	readonly pluginSlug: string;
	readonly compiledHashes: Readonly<Record<string, string>>;
};

const REVISION_CACHE_CAPACITY = 256;

const revisionFields = {
	id: schema.pluginRevision.id,
	pluginSlug: schema.plugin.slug,
	version: schema.pluginRevision.version,
	manifest: schema.pluginRevision.manifest,
	pluginId: schema.pluginRevision.pluginId,
	sourceHash: schema.pluginRevision.sourceHash,
};

type RevisionRow = Pick<
	typeof schema.pluginRevision.$inferSelect,
	"id" | "manifest" | "pluginId" | "sourceHash" | "version"
> & { readonly pluginSlug: (typeof schema.plugin.$inferSelect)["slug"] };

const toCachedRevision = Effect.fn(function* (
	row: RevisionRow,
	scripts: ReadonlyArray<{ readonly slug: string; readonly contentHash: string }>,
) {
	const manifest = yield* Schema.decodeEffect(PluginManifest)(row.manifest).pipe(
		Effect.mapError(
			() => new DbError({ message: `Plugin ${row.pluginSlug} has an invalid retained manifest` }),
		),
	);
	const storedHashes = new Map(scripts.map((script) => [script.slug, script.contentHash]));
	const compiledHashes: Record<string, string> = {};
	const descriptors: Array<PluginScriptDescriptor> = [];
	for (const script of manifest.scripts) {
		const contentHash = storedHashes.get(script.slug);
		if (!contentHash) {
			return yield* new DbError({
				message: `Plugin ${row.pluginSlug} is missing compiled script ${script.slug}`,
			});
		}
		const { entry, ...metadata } = script;
		compiledHashes[script.slug] = contentHash;
		descriptors.push({ entry, metadata, contentHash, slug: script.slug, name: script.name });
	}
	return deepFreeze({
		manifest,
		id: row.id,
		compiledHashes,
		version: row.version,
		scripts: descriptors,
		pluginId: row.pluginId,
		sourceHash: row.sourceHash,
		pluginSlug: row.pluginSlug,
	} satisfies CachedPluginRevision);
});

const loadRevisions = Effect.fn("PluginRepository.loadRevisions")(function* (
	ids: ReadonlyArray<string>,
) {
	const db = yield* Database;
	const rows = yield* mapDatabaseErrors(
		db
			.select(revisionFields)
			.from(schema.pluginRevision)
			.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginRevision.pluginId))
			.where(inArray(schema.pluginRevision.id, ids)),
	);
	const scripts = yield* mapDatabaseErrors(
		db
			.select({
				slug: schema.sandboxScript.slug,
				contentHash: schema.sandboxScript.contentHash,
				pluginRevisionId: schema.sandboxScript.pluginRevisionId,
			})
			.from(schema.sandboxScript)
			.where(inArray(schema.sandboxScript.pluginRevisionId, ids)),
	);
	return yield* Effect.forEach(rows, (row) =>
		toCachedRevision(
			row,
			scripts.filter(({ pluginRevisionId }) => pluginRevisionId === row.id),
		),
	);
});

const lookupRevision = Effect.fn("PluginRepository.lookupRevision")(function* (
	pluginRevisionId: string,
) {
	const [revision] = yield* loadRevisions([pluginRevisionId]);
	if (!revision) {
		return yield* new DbError({ message: `Plugin revision ${pluginRevisionId} is not persisted` });
	}
	return revision;
});

const toStoredPlugin = Effect.fn(function* (
	pointer: PluginPointerRow,
	revision: CachedPluginRevision,
) {
	let identity: StoredPluginIdentity | null = null;
	if (pointer.scope === "system" && pointer.ownerId === null) {
		identity = { ownerId: null, id: pointer.id, scope: "system", slug: pointer.slug };
	} else if (pointer.scope === "user" && pointer.ownerId !== null) {
		identity = { scope: "user", id: pointer.id, slug: pointer.slug, ownerId: pointer.ownerId };
	}
	if (!identity) {
		return yield* new DbError({ message: `Plugin ${pointer.slug} has invalid persisted identity` });
	}
	return {
		...identity,
		status: pointer.status,
		scripts: revision.scripts,
		manifest: revision.manifest,
		sourceHash: revision.sourceHash,
	} satisfies StoredPlugin;
});

export class PluginRepository extends Context.Service<PluginRepository>()("PluginRepository", {
	make: Effect.gen(function* () {
		const configs = yield* PluginConfigRevisions;
		const kernelScriptHashes = new Map<string, string>();
		const lockIngestion = Effect.fn("PluginRepository.lockIngestion")(function* () {
			const db = yield* Database;
			yield* mapDatabaseErrors(
				db.execute(
					sql`select pg_advisory_xact_lock(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
				),
			);
		});

		const lockIngestionShared = Effect.fn("PluginRepository.lockIngestionShared")(function* () {
			const db = yield* Database;
			yield* mapDatabaseErrors(
				db.execute(
					sql`select pg_advisory_xact_lock_shared(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
				),
			);
		});

		// Keyed by `plugin_revision.id`, which addresses write-once content: `persist` refuses to
		// change a retained revision's manifest or its scripts. A deleted revision can never be
		// pointed to as active, so no read ever needs to invalidate; `persist` invalidates the
		// single key it writes.
		const revisions = yield* Cache.makeWith(lookupRevision, {
			requireServicesAt: "lookup",
			capacity: REVISION_CACHE_CAPACITY,
			// `Cache.get` memoizes the lookup `Exit`, so a failed read must expire at once.
			timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
		});

		const readRevision = (pluginRevisionId: string) => Cache.get(revisions, pluginRevisionId);

		const readRevisions = Effect.fn("PluginRepository.readRevisions")(function* (
			ids: ReadonlyArray<string>,
		) {
			const result = new Map<string, CachedPluginRevision>();
			const misses: Array<string> = [];
			for (const id of new Set(ids)) {
				// `getSuccess`, not `getOption`: it never awaits a pending entry, so a list read is
				// never joined onto another transaction's in-flight lookup fiber.
				const cached = yield* Cache.getSuccess(revisions, id);
				if (Option.isSome(cached)) {
					result.set(id, cached.value);
				} else {
					misses.push(id);
				}
			}
			if (misses.length > 0) {
				for (const revision of yield* loadRevisions(misses)) {
					yield* Cache.set(revisions, revision.id, revision);
					result.set(revision.id, revision);
				}
			}
			return result;
		});

		const toStoredPlugins = Effect.fn(function* (rows: ReadonlyArray<PluginPointerRow>) {
			const revisionsById = yield* readRevisions(
				rows.flatMap(({ activeRevisionId }) => (activeRevisionId ? [activeRevisionId] : [])),
			);
			return yield* Effect.forEach(rows, (row) => {
				const revision = row.activeRevisionId ? revisionsById.get(row.activeRevisionId) : undefined;
				return revision
					? toStoredPlugin(row, revision)
					: new DbError({ message: `Plugin ${row.slug} has no retained active revision` });
			});
		});

		const list = Effect.fn("PluginRepository.list")(function* () {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select(pluginPointerFields)
					.from(schema.plugin)
					.where(and(eq(schema.plugin.status, "active"), eq(schema.plugin.scope, "system"))),
			);
			return yield* toStoredPlugins(rows);
		});

		const listPrivateForUser = Effect.fn("PluginRepository.listPrivateForUser")(function* (
			userId: string,
		) {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select(pluginPointerFields)
					.from(schema.plugin)
					.where(
						and(
							eq(schema.plugin.status, "active"),
							eq(schema.plugin.scope, "user"),
							eq(schema.plugin.ownerId, userId),
						),
					),
			);
			return yield* toStoredPlugins(rows);
		});

		const findPrivateByIdForUser = Effect.fn("PluginRepository.findPrivateByIdForUser")(function* (
			pluginId: string,
			userId: string,
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select(pluginPointerFields)
					.from(schema.plugin)
					.where(
						and(
							eq(schema.plugin.id, pluginId),
							eq(schema.plugin.status, "active"),
							eq(schema.plugin.scope, "user"),
							eq(schema.plugin.ownerId, userId),
						),
					)
					.limit(1),
			);
			if (!row?.activeRevisionId) {
				return null;
			}
			return yield* toStoredPlugin(row, yield* readRevision(row.activeRevisionId));
		});

		const listActiveManifests = Effect.fn("PluginRepository.listActiveManifests")(function* () {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select({ activeRevisionId: schema.plugin.activeRevisionId })
					.from(schema.plugin)
					.where(and(eq(schema.plugin.status, "active"), eq(schema.plugin.scope, "system"))),
			);
			const revisionsById = yield* readRevisions(
				rows.flatMap(({ activeRevisionId }) => (activeRevisionId ? [activeRevisionId] : [])),
			);
			return rows.flatMap(({ activeRevisionId }) => {
				const revision = activeRevisionId ? revisionsById.get(activeRevisionId) : undefined;
				return revision ? [revision.manifest] : [];
			});
		});

		const listPortablePluginMetadata = Effect.fn("PluginRepository.listPortablePluginMetadata")(
			function* () {
				const db = yield* Database;
				const rows = yield* mapDatabaseErrors(
					db
						.select({
							id: schema.plugin.id,
							slug: schema.plugin.slug,
							activeRevisionId: schema.plugin.activeRevisionId,
						})
						.from(schema.plugin)
						.where(and(eq(schema.plugin.status, "active"), eq(schema.plugin.scope, "system")))
						.orderBy(asc(schema.plugin.slug)),
				);
				const revisionsById = yield* readRevisions(
					rows.flatMap(({ activeRevisionId }) => (activeRevisionId ? [activeRevisionId] : [])),
				);
				return rows.flatMap(({ id, slug, activeRevisionId }) => {
					const revision = activeRevisionId ? revisionsById.get(activeRevisionId) : undefined;
					if (!revision) {
						return [];
					}
					const manifest = revision.manifest;
					return [
						{
							id,
							slug,
							client: manifest.client,
							version: revision.version,
							metadata: manifest.metadata,
							sourceHash: revision.sourceHash,
							configSchema: manifest.configSchema,
							integrationProviders: manifest.integrationProviders,
							signalSchemaSlugs: manifest.signalSchemas.map(
								({ slug: signalSchemaSlug }) => signalSchemaSlug,
							),
							relationshipSchemaSlugs: manifest.relationshipSchemas.map(
								({ slug: relationshipSchemaSlug }) => relationshipSchemaSlug,
							),
						},
					];
				});
			},
		);

		const resolveProviderBySlugs = Effect.fn("PluginRepository.resolveProviderBySlugs")(
			function* (input: { pluginId: string; providerSlug: string }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({
							id: schema.sandboxProvider.id,
							entitySchemaSlug: schema.sandboxProvider.rootEntitySchemaSlug,
						})
						.from(schema.sandboxProvider)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
						.where(
							and(
								eq(schema.plugin.status, "active"),
								eq(schema.sandboxProvider.slug, input.providerSlug),
								eq(schema.sandboxProvider.pluginId, input.pluginId),
							),
						)
						.limit(1),
				);
				return row ? { ...row, id: SandboxProviderId.make(row.id) } : null;
			},
		);

		const hasEntityReferences = Effect.fn("PluginRepository.hasEntityReferences")(
			function* (input: { pluginId: string; entitySchemaSlugs: ReadonlyArray<string> }) {
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
							or(
								eq(schema.entity.entitySchemaPluginId, input.pluginId),
								eq(schema.sandboxProvider.pluginId, input.pluginId),
							),
						)
						.limit(1),
				);
				return row !== undefined;
			},
		);

		const hasIntegrationReferences = Effect.fn("PluginRepository.hasIntegrationReferences")(
			function* (input: { pluginId: string; pluginInstallationId?: string }) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.integration.id })
						.from(schema.integration)
						.innerJoin(
							schema.pluginInstallation,
							eq(schema.pluginInstallation.id, schema.integration.pluginInstallationId),
						)
						.where(
							and(
								eq(schema.pluginInstallation.pluginId, input.pluginId),
								input.pluginInstallationId
									? eq(schema.pluginInstallation.id, input.pluginInstallationId)
									: undefined,
							),
						)
						.limit(1),
				);
				return row !== undefined;
			},
		);

		const hasDefinitionReferences = Effect.fn("PluginRepository.hasDefinitionReferences")(
			function* (pluginId: string) {
				const db = yield* Database;
				const [relationship] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.relationship.id })
						.from(schema.relationship)
						.where(eq(schema.relationship.relationshipSchemaPluginId, pluginId))
						.limit(1),
				);
				if (relationship) {
					return true;
				}

				const [subscription] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.notificationSubscription.id })
						.from(schema.notificationSubscription)
						.where(eq(schema.notificationSubscription.signalSchemaPluginId, pluginId))
						.limit(1),
				);
				if (subscription) {
					return true;
				}
				return false;
			},
		);

		const findBySourceHash = Effect.fn("PluginRepository.findBySourceHash")(function* (
			input: PluginPersistenceIdentity & { readonly sourceHash: string },
		) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select(pluginPointerFields)
					.from(schema.plugin)
					.innerJoin(
						schema.pluginRevision,
						eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
					)
					.where(
						and(
							eq(schema.plugin.slug, input.slug),
							eq(schema.plugin.scope, input.scope),
							eq(schema.plugin.status, "active"),
							eq(schema.pluginRevision.sourceHash, input.sourceHash),
							input.ownerId === null
								? isNull(schema.plugin.ownerId)
								: eq(schema.plugin.ownerId, input.ownerId),
						),
					)
					.limit(1),
			);
			if (!row?.activeRevisionId) {
				return null;
			}
			return yield* toStoredPlugin(row, yield* readRevision(row.activeRevisionId));
		});

		const findTestSupportOperationResult = Effect.fn(
			"PluginRepository.findTestSupportOperationResult",
		)(function* (identity: PluginPersistenceIdentity) {
			const db = yield* Database;
			const [plugin] = yield* mapDatabaseErrors(
				db
					.select({
						id: schema.plugin.id,
						slug: schema.plugin.slug,
						activeRevisionId: schema.plugin.activeRevisionId,
					})
					.from(schema.plugin)
					.where(
						and(
							eq(schema.plugin.slug, identity.slug),
							eq(schema.plugin.scope, identity.scope),
							eq(schema.plugin.status, "active"),
							identity.ownerId === null
								? isNull(schema.plugin.ownerId)
								: eq(schema.plugin.ownerId, identity.ownerId),
						),
					)
					.limit(1),
			);
			if (!plugin?.activeRevisionId) {
				return null;
			}
			const activeRevisionId = plugin.activeRevisionId;
			const revision = yield* readRevision(activeRevisionId);
			const scripts = yield* mapDatabaseErrors(
				db
					.select({
						id: schema.sandboxScript.id,
						slug: schema.sandboxScript.slug,
						contentHash: schema.sandboxScript.contentHash,
					})
					.from(schema.sandboxScript)
					.where(eq(schema.sandboxScript.pluginRevisionId, activeRevisionId))
					.orderBy(asc(schema.sandboxScript.slug)),
			);
			if (identity.scope === "system") {
				return {
					...plugin,
					scripts,
					activeRevisionId,
					installationId: null,
					scope: identity.scope,
					configRevisionId: null,
					manifest: revision.manifest,
					sourceHash: revision.sourceHash,
				};
			}
			const [installation] = yield* mapDatabaseErrors(
				db
					.select({
						id: schema.pluginInstallation.id,
						configRevisionId: schema.pluginInstallation.activeConfigRevisionId,
					})
					.from(schema.pluginInstallation)
					.where(
						and(
							eq(schema.pluginInstallation.pluginId, plugin.id),
							eq(schema.pluginInstallation.userId, identity.ownerId),
							isNull(schema.pluginInstallation.uninstalledAt),
						),
					)
					.limit(1),
			);
			if (!installation?.configRevisionId) {
				return null;
			}
			return {
				...plugin,
				scripts,
				activeRevisionId,
				scope: identity.scope,
				manifest: revision.manifest,
				sourceHash: revision.sourceHash,
				installationId: installation.id,
				configRevisionId: installation.configRevisionId,
			};
		});

		const isActiveRevision = Effect.fn("PluginRepository.isActiveRevision")(function* (input: {
			readonly pluginId: string;
			readonly sourceHash: string;
		}) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ id: schema.plugin.id })
					.from(schema.plugin)
					.innerJoin(
						schema.pluginRevision,
						eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
					)
					.where(
						and(
							eq(schema.plugin.id, input.pluginId),
							eq(schema.plugin.status, "active"),
							eq(schema.pluginRevision.sourceHash, input.sourceHash),
						),
					)
					.limit(1),
			);
			return row !== undefined;
		});

		const listSourceFiles = Effect.fn("PluginRepository.listSourceFiles")(function* (
			pluginId: string,
		) {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select({
						path: schema.pluginRevisionSourceFile.path,
						contents: schema.pluginRevisionSourceFile.contents,
					})
					.from(schema.pluginRevisionSourceFile)
					.innerJoin(
						schema.plugin,
						eq(schema.plugin.activeRevisionId, schema.pluginRevisionSourceFile.pluginRevisionId),
					)
					.where(eq(schema.plugin.id, pluginId))
					.orderBy(asc(schema.pluginRevisionSourceFile.path)),
			);
			return Object.fromEntries(rows.map(({ path, contents }) => [path, new Uint8Array(contents)]));
		});

		const listAuthorizedSourceFiles = Effect.fn("PluginRepository.listAuthorizedSourceFiles")(
			function* (input: {
				readonly userId: string;
				readonly pluginId: string;
				readonly sourceHash: string;
				readonly installationId: string;
			}) {
				const db = yield* Database;
				const [authorized] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.plugin.id })
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(
							and(
								eq(schema.plugin.id, input.pluginId),
								eq(schema.plugin.status, "active"),
								eq(schema.pluginRevision.sourceHash, input.sourceHash),
								isNull(schema.pluginInstallation.uninstalledAt),
								eq(schema.pluginInstallation.userId, input.userId),
								eq(schema.pluginInstallation.id, input.installationId),
							),
						)
						.limit(1),
				);
				return authorized ? yield* listSourceFiles(input.pluginId) : null;
			},
		);

		const persistClientArtifact = Effect.fn("PluginRepository.persistClientArtifact")(function* (
			artifact: PluginClientArtifact,
		) {
			const db = yield* Database;
			const [inserted] = yield* mapDatabaseErrors(
				db
					.insert(schema.pluginClientArtifact)
					.values({
						hash: artifact.hash,
						format: artifact.format,
						apiVersion: artifact.apiVersion,
						bridgeVersion: artifact.bridgeVersion,
						compilerVersion: artifact.compilerVersion,
					})
					.onConflictDoNothing()
					.returning({ hash: schema.pluginClientArtifact.hash }),
			);
			if (inserted) {
				if (artifact.files.length > 0) {
					yield* mapDatabaseErrors(
						db
							.insert(schema.pluginClientArtifactFile)
							.values(
								artifact.files.map((file) => ({
									...file,
									artifactHash: artifact.hash,
									contents: Buffer.from(file.contents),
								})),
							),
					);
				}
				return undefined;
			}
			const [metadata] = yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.pluginClientArtifact)
					.where(eq(schema.pluginClientArtifact.hash, artifact.hash))
					.limit(1),
			);
			const files = yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.pluginClientArtifactFile)
					.where(eq(schema.pluginClientArtifactFile.artifactHash, artifact.hash)),
			);
			if (!metadata || !clientArtifactMatches(artifact, metadata, files)) {
				return yield* new DbError({
					message: `Client artifact ${artifact.hash} conflicts with immutable stored data`,
				});
			}
			return undefined;
		});

		const persistKernelScript = Effect.fn("PluginRepository.persistKernelScript")(function* (
			script: PersistedScript,
		) {
			const db = yield* Database;
			yield* mapDatabaseErrors(
				db
					.insert(schema.sandboxScript)
					.values({ ...script, pluginRevisionId: null })
					.onConflictDoNothing(),
			);
			const [existing] = yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.sandboxScript)
					.where(
						and(
							eq(schema.sandboxScript.slug, script.slug),
							eq(schema.sandboxScript.contentHash, script.contentHash),
							isNull(schema.sandboxScript.pluginRevisionId),
						),
					)
					.limit(1),
			);
			if (
				existing?.providerId !== null ||
				existing.name !== script.name ||
				existing.source !== script.source ||
				existing.compiledCode !== script.compiledCode ||
				existing.compiledFormat !== script.compiledFormat ||
				stableStringify(existing.metadata) !== stableStringify(script.metadata)
			) {
				return yield* new DbError({
					message: `Kernel script ${script.slug} conflicts with immutable stored data`,
				});
			}
			kernelScriptHashes.set(script.slug, script.contentHash);
			return undefined;
		});

		const persist = Effect.fn("PluginRepository.persist")(function* (
			plugin: NormalizedPlugin,
			identity: PluginPersistenceIdentity,
		) {
			const db = yield* Database;
			const slug = identity.slug;
			const mutation = { status: "installing" } as const;
			const conflict =
				identity.scope === "system"
					? {
							set: mutation,
							target: schema.plugin.slug,
							targetWhere: sql`${schema.plugin.scope} = 'system'`,
						}
					: {
							set: mutation,
							targetWhere: sql`${schema.plugin.scope} = 'user'`,
							target: [schema.plugin.ownerId, schema.plugin.slug],
						};
			const [persisted] = yield* mapDatabaseErrors(
				db
					.insert(schema.plugin)
					.values({ ...mutation, slug, scope: identity.scope, ownerId: identity.ownerId })
					.onConflictDoUpdate(conflict)
					.returning({ id: schema.plugin.id }),
			);
			if (!persisted) {
				return yield* new DbError({ message: `Plugin ${slug} could not be persisted` });
			}
			const pluginId = persisted.id;
			const [existingRevision] = yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.pluginRevision)
					.where(
						and(
							eq(schema.pluginRevision.pluginId, pluginId),
							eq(schema.pluginRevision.sourceHash, plugin.sourceHash),
						),
					)
					.limit(1),
			);
			if (
				existingRevision &&
				stableStringify(existingRevision.manifest) !== stableStringify(plugin.manifest)
			) {
				return yield* new DbError({
					message: "Immutable plugin revision conflicts with stored manifest",
				});
			}
			const revision =
				existingRevision ??
				(yield* mapDatabaseErrors(
					db
						.insert(schema.pluginRevision)
						.values({
							pluginId,
							manifest: plugin.manifest,
							sourceHash: plugin.sourceHash,
							version: plugin.manifest.metadata.version,
						})
						.returning(),
				))[0];
			if (!revision) {
				return yield* new DbError({ message: "Plugin revision could not be persisted" });
			}
			const pluginRevisionId = revision.id;
			const sourceEntries = Object.entries(plugin.files);
			const retainedFiles = yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.pluginRevisionSourceFile)
					.where(eq(schema.pluginRevisionSourceFile.pluginRevisionId, pluginRevisionId)),
			);
			if (
				retainedFiles.length > 0 &&
				(retainedFiles.length !== sourceEntries.length ||
					retainedFiles.some((file) => {
						const contents = plugin.files[file.path];
						return !contents || !bytesEqual(file.contents, contents);
					}))
			) {
				return yield* new DbError({
					message: "Immutable plugin revision conflicts with retained source files",
				});
			}
			if (sourceEntries.length > 0) {
				yield* mapDatabaseErrors(
					db
						.insert(schema.pluginRevisionSourceFile)
						.values(
							sourceEntries.map(([path, contents]) => ({
								path,
								pluginRevisionId,
								contents: Buffer.from(contents),
							})),
						)
						.onConflictDoNothing(),
				);
			}
			const existingProviders = yield* mapDatabaseErrors(
				db
					.select({ id: schema.sandboxProvider.id, slug: schema.sandboxProvider.slug })
					.from(schema.sandboxProvider)
					.where(eq(schema.sandboxProvider.pluginId, pluginId)),
			);
			const providers =
				plugin.manifest.providers.length > 0
					? yield* mapDatabaseErrors(
							db
								.insert(schema.sandboxProvider)
								.values(
									plugin.manifest.providers.map((provider) => ({
										pluginId,
										slug: provider.slug,
										name: provider.name,
										information: provider.information,
										rootEntitySchemaSlug: provider.rootEntitySchemaSlug,
									})),
								)
								.onConflictDoUpdate({
									target: [schema.sandboxProvider.pluginId, schema.sandboxProvider.slug],
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
					(script) =>
						Effect.gen(function* () {
							const providerSlug =
								"providerSlug" in script.metadata ? script.metadata.providerSlug : undefined;
							const providerId = providerSlug ? providerIdBySlug.get(providerSlug) : undefined;
							if (providerSlug && !providerId) {
								return yield* new DbError({
									message: `Plugin ${slug} is missing provider ${providerSlug}`,
								});
							}
							const [retained] = yield* mapDatabaseErrors(
								db
									.select()
									.from(schema.sandboxScript)
									.where(
										and(
											eq(schema.sandboxScript.pluginRevisionId, pluginRevisionId),
											eq(schema.sandboxScript.slug, script.slug),
										),
									)
									.limit(1),
							);
							if (retained) {
								if (
									retained.contentHash !== script.contentHash ||
									retained.source !== script.source ||
									retained.compiledCode !== script.compiledCode ||
									retained.compiledFormat !== script.compiledFormat ||
									retained.name !== script.name ||
									stableStringify(retained.metadata) !== stableStringify(script.metadata) ||
									retained.providerId !== (providerId ?? null)
								) {
									return yield* new DbError({
										message: "Immutable plugin revision conflicts with retained script",
									});
								}
								return [retained];
							}
							return yield* mapDatabaseErrors(
								db
									.insert(schema.sandboxScript)
									.values({
										pluginRevisionId,
										slug: script.slug,
										name: script.name,
										source: script.source,
										metadata: script.metadata,
										providerId: providerId ?? null,
										contentHash: script.contentHash,
										compiledCode: script.compiledCode,
										compiledFormat: script.compiledFormat,
									})
									.returning({
										id: schema.sandboxScript.id,
										slug: schema.sandboxScript.slug,
										contentHash: schema.sandboxScript.contentHash,
									}),
							);
						}),
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
			yield* mapDatabaseErrors(
				db
					.update(schema.plugin)
					.set({ status: "active", activeRevisionId: pluginRevisionId })
					.where(eq(schema.plugin.id, pluginId)),
			);
			// `persist` is the only writer of revision content. A revision whose scripts were
			// garbage-collected while it was inactive gets them reinserted here, so drop any entry
			// cached before that. Running inside a transaction that may roll back is safe:
			// invalidation only ever loses a cached value, it never introduces a wrong one.
			yield* Cache.invalidate(revisions, pluginRevisionId);
			return pluginId;
		});

		const deactivate = Effect.fn("PluginRepository.deactivate")(function* (pluginId: string) {
			const db = yield* Database;
			yield* mapDatabaseErrors(
				db.update(schema.plugin).set({ status: "inactive" }).where(eq(schema.plugin.id, pluginId)),
			);
		});

		const deleteInactiveUnreferencedPlugins = Effect.fn(
			"PluginRepository.deleteInactiveUnreferencedPlugins",
		)(function* (limit: number) {
			const db = yield* Database;
			const candidates = db
				.select({ id: schema.plugin.id })
				.from(schema.plugin)
				.where(
					and(
						eq(schema.plugin.scope, "user"),
						eq(schema.plugin.status, "inactive"),
						notExists(
							db
								.select({ id: schema.pluginInstallation.id })
								.from(schema.pluginInstallation)
								.where(eq(schema.pluginInstallation.pluginId, schema.plugin.id)),
						),
						notExists(
							db
								.select({ id: schema.entity.id })
								.from(schema.entity)
								.where(eq(schema.entity.entitySchemaPluginId, schema.plugin.id)),
						),
						notExists(
							db
								.select({ id: schema.event.id })
								.from(schema.event)
								.where(eq(schema.event.eventSchemaPluginId, schema.plugin.id)),
						),
						notExists(
							db
								.select({ id: schema.relationship.id })
								.from(schema.relationship)
								.where(eq(schema.relationship.relationshipSchemaPluginId, schema.plugin.id)),
						),
						notExists(
							db
								.select({ id: schema.automationRun.id })
								.from(schema.automationRun)
								.where(eq(schema.automationRun.pluginId, schema.plugin.id)),
						),
						notExists(
							db
								.select({ id: schema.notificationSubscription.id })
								.from(schema.notificationSubscription)
								.where(eq(schema.notificationSubscription.signalSchemaPluginId, schema.plugin.id)),
						),
						notExists(
							db
								.select({ executionId: schema.sandboxWorkflowReference.executionId })
								.from(schema.sandboxWorkflowReference)
								.where(eq(schema.sandboxWorkflowReference.pluginId, schema.plugin.id)),
						),
						notExists(
							db
								.select({ id: schema.entity.id })
								.from(schema.entity)
								.innerJoin(
									schema.sandboxProvider,
									eq(schema.entity.providerId, schema.sandboxProvider.id),
								)
								.where(eq(schema.sandboxProvider.pluginId, schema.plugin.id)),
						),
					),
				)
				.orderBy(asc(schema.plugin.id))
				.limit(limit);
			return yield* mapDatabaseErrors(
				db
					.delete(schema.plugin)
					.where(inArray(schema.plugin.id, candidates))
					.returning({ id: schema.plugin.id }),
			);
		});

		const deleteUnreferencedScripts = Effect.fn("PluginRepository.deleteUnreferencedScripts")(
			function* (liveContentHashes: ReadonlySet<string>, input: { now: Date; limit: number }) {
				const db = yield* Database;
				const executionReference = retainedScriptExecution(input.now);
				const candidates = db
					.select({ id: schema.sandboxScript.id })
					.from(schema.sandboxScript)
					.where(
						and(
							liveContentHashes.size > 0
								? notInArray(schema.sandboxScript.contentHash, [...liveContentHashes])
								: undefined,
							not(executionReference),
							notExists(
								db
									.select({ id: schema.plugin.id })
									.from(schema.plugin)
									.where(
										and(
											eq(schema.plugin.activeRevisionId, schema.sandboxScript.pluginRevisionId),
											eq(schema.plugin.status, "active"),
										),
									),
							),
						),
					)
					.orderBy(asc(schema.sandboxScript.id))
					.limit(input.limit);
				yield* mapDatabaseErrors(
					db
						.delete(schema.sandboxProviderOperation)
						.where(inArray(schema.sandboxProviderOperation.scriptId, candidates)),
				);
				return yield* mapDatabaseErrors(
					db
						.delete(schema.sandboxScript)
						.where(inArray(schema.sandboxScript.id, candidates))
						.returning({
							id: schema.sandboxScript.id,
							contentHash: schema.sandboxScript.contentHash,
						}),
				);
			},
		);

		const listPersistedLivenessContentHashes = Effect.fn(
			"PluginRepository.listPersistedLivenessContentHashes",
		)(function* (now: Date) {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select({ contentHash: schema.sandboxScript.contentHash })
					.from(schema.sandboxScript)
					.where(
						or(
							kernelScriptHashes.size > 0
								? and(
										isNull(schema.sandboxScript.pluginRevisionId),
										inArray(schema.sandboxScript.contentHash, [...kernelScriptHashes.values()]),
									)
								: sql`false`,
							retainedScriptExecution(now),
							exists(
								db
									.select({ id: schema.plugin.id })
									.from(schema.plugin)
									.where(
										and(
											eq(schema.plugin.activeRevisionId, schema.sandboxScript.pluginRevisionId),
											eq(schema.plugin.status, "active"),
										),
									),
							),
						),
					),
			);
			return rows.map(({ contentHash }) => contentHash);
		});

		return {
			list,
			persist,
			deactivate,
			readRevision,
			readRevisions,
			lockIngestion,
			listSourceFiles,
			findBySourceHash,
			isActiveRevision,
			listPrivateForUser,
			lockIngestionShared,
			persistKernelScript,
			hasEntityReferences,
			listActiveManifests,
			persistClientArtifact,
			resolveProviderBySlugs,
			findPrivateByIdForUser,
			hasDefinitionReferences,
			hasIntegrationReferences,
			listAuthorizedSourceFiles,
			deleteUnreferencedScripts,
			listPortablePluginMetadata,
			findTestSupportOperationResult,
			deleteInactiveUnreferencedPlugins,
			listPersistedLivenessContentHashes,
			validateConfigurationKeys: configs.validateKeys,
			getKernelScriptContentHash: (slug: string) => Effect.sync(() => kernelScriptHashes.get(slug)),
			// Ordered by `plugin.id` so the per-plugin advisory locks match `lockCatalog`.
			resolveEnvironmentConfigs: Effect.fn("PluginRepository.resolveEnvironmentConfigs")(
				function* () {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select(pluginPointerFields)
							.from(schema.plugin)
							.where(and(eq(schema.plugin.status, "active"), eq(schema.plugin.scope, "system")))
							.orderBy(asc(schema.plugin.id)),
					);
					const revisionsById = yield* readRevisions(
						rows.flatMap(({ activeRevisionId }) => (activeRevisionId ? [activeRevisionId] : [])),
					);
					const snapshot: Record<string, PluginEnvironmentConfigEntry> = {};
					for (const row of rows) {
						const pluginRevisionId = row.activeRevisionId;
						const revision = pluginRevisionId ? revisionsById.get(pluginRevisionId) : undefined;
						if (!pluginRevisionId || !revision) {
							continue;
						}
						const configRevisionId = yield* configs.resolveEnvironment({
							pluginRevisionId,
							pluginId: row.id,
							pluginSlug: row.slug,
							configSchema: revision.manifest.configSchema,
						});
						yield* Effect.logInfo(
							`Resolved environment configuration ${configRevisionId} for plugin ${row.slug}`,
						);
						snapshot[row.id] = { configRevisionId, pluginRevisionId };
					}
					return snapshot satisfies PluginEnvironmentConfigSnapshot;
				},
			),
			pruneRevisionArtifacts: Effect.fn("PluginRepository.pruneRevisionArtifacts")(
				function* (input: { now: Date; limit: number; retryWindowDays: number }) {
					const db = yield* Database;
					yield* mapDatabaseErrors(
						db.execute(sql`with candidates as (
					select i.id from plugin_installation i where i.uninstalled_at <= ${input.now} - ${input.retryWindowDays} * interval '1 day'
					and not exists (select 1 from sandbox_workflow_reference w where w.plugin_installation_id = i.id)
					and not exists (select 1 from automation_run r join plugin_config_revision c on c.id = r.plugin_config_revision_id where c.plugin_installation_id = i.id and (r.status in ('queued', 'running') or r.artifacts_expire_at > ${input.now}))
					limit ${input.limit}
				) delete from plugin_installation where id in (select id from candidates)`),
					);
					yield* mapDatabaseErrors(
						db.execute(sql`with candidates as (
					select c.id from plugin_config_revision c
					where c.encrypted_payload is not null
					and not exists (select 1 from plugin_installation i where i.active_config_revision_id = c.id and i.uninstalled_at is null)
					and c.scope <> 'environment'
					and not exists (select 1 from automation_run r where r.plugin_config_revision_id = c.id and (r.status in ('queued', 'running') or r.artifacts_expire_at > ${input.now}))
					and not exists (select 1 from sandbox_workflow_reference w where w.plugin_installation_id = c.plugin_installation_id or w.plugin_id = (select plugin_id from plugin_revision where id = c.plugin_revision_id))
					limit ${input.limit}
				) update plugin_config_revision set encrypted_payload = null, payload_pruned_at = ${input.now} where id in (select id from candidates)`),
					);
					yield* mapDatabaseErrors(
						db.execute(sql`with candidates as (
					select distinct f.plugin_revision_id from plugin_revision_source_file f
					where not exists (select 1 from plugin p where p.active_revision_id = f.plugin_revision_id and p.status = 'active')
					and not exists (select 1 from automation_run r where r.plugin_revision_id = f.plugin_revision_id and (r.status in ('queued', 'running') or r.artifacts_expire_at > ${input.now}))
					and not exists (select 1 from sandbox_workflow_reference w join sandbox_script s on s.id = w.script_id where s.plugin_revision_id = f.plugin_revision_id)
					limit ${input.limit}
				) delete from plugin_revision_source_file where plugin_revision_id in (select plugin_revision_id from candidates)`),
					);
				},
			),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(PluginConfigRevisions.layer),
	);
}
