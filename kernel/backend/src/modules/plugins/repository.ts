import {
	clientArtifactMetadata,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { DbError } from "@ryot-app/contract/errors";
import {
	PluginManifest,
	type PluginHttpRateLimit,
} from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxProviderId, SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	and,
	asc,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	not,
	notExists,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { ClientArtifactsRepository } from "#modules/client-artifacts/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { revisionDefinitions } from "#modules/definition-registry/source";

import { redactPluginConfig } from "./config-redaction";
import { PluginConfigRevisions } from "./config-revisions";
import { pluginPointerFields, storedScriptFields } from "./persisted-projections";
import { normalizePluginSource } from "./pipeline";
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

type LoadedPluginRevision = PluginRevision & {
	readonly id: string;
	readonly version: string;
	readonly pluginId: string;
	readonly pluginSlug: string;
	readonly compiledHashes: Readonly<Record<string, string>>;
};

const revisionFields = {
	id: schema.pluginRevision.id,
	pluginSlug: schema.plugin.slug,
	manifest: schema.pluginRevision.manifest,
	pluginId: schema.pluginRevision.pluginId,
	sourceHash: schema.pluginRevision.sourceHash,
};

type RevisionRow = Pick<
	typeof schema.pluginRevision.$inferSelect,
	"id" | "manifest" | "pluginId" | "sourceHash"
> & { readonly pluginSlug: (typeof schema.plugin.$inferSelect)["slug"] };

export const decodeStoredManifest = (manifest: unknown, pluginSlug: string) =>
	Schema.decodeUnknownEffect(PluginManifest)(manifest).pipe(
		Effect.mapError(
			() => new DbError({ message: `Plugin ${pluginSlug} has an invalid retained manifest` }),
		),
	);

const toLoadedRevision = Effect.fn(function* (
	row: RevisionRow,
	scripts: ReadonlyArray<{ readonly slug: string; readonly contentHash: string }>,
) {
	const manifest = yield* decodeStoredManifest(row.manifest, row.pluginSlug);
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
	return {
		manifest,
		id: row.id,
		compiledHashes,
		scripts: descriptors,
		pluginId: row.pluginId,
		sourceHash: row.sourceHash,
		pluginSlug: row.pluginSlug,
		version: manifest.metadata.version,
	} satisfies LoadedPluginRevision;
});

const loadRevisionsForSession = (database: DatabaseSession["Service"]) =>
	Effect.fn("PluginRepository.loadRevisions")(function* (ids: ReadonlyArray<string>) {
		const rows = yield* database.run((db) =>
			db
				.select(revisionFields)
				.from(schema.pluginRevision)
				.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginRevision.pluginId))
				.where(inArray(schema.pluginRevision.id, ids)),
		);
		const scripts = yield* database.run((db) =>
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
			toLoadedRevision(
				row,
				scripts.filter(({ pluginRevisionId }) => pluginRevisionId === row.id),
			),
		);
	});

const lookupRevisionForSession = (loadRevisions: ReturnType<typeof loadRevisionsForSession>) =>
	Effect.fn("PluginRepository.lookupRevision")(function* (pluginRevisionId: string) {
		const [revision] = yield* loadRevisions([pluginRevisionId]);
		if (!revision) {
			return yield* new DbError({
				message: `Plugin revision ${pluginRevisionId} is not persisted`,
			});
		}
		return revision;
	});

const toStoredPlugin = (pointer: PluginPointerRow, revision: LoadedPluginRevision) => {
	const identity: StoredPluginIdentity =
		pointer.ownerId === null
			? { ownerId: null, id: pointer.id, scope: "system", slug: pointer.slug }
			: { scope: "user", id: pointer.id, slug: pointer.slug, ownerId: pointer.ownerId };
	return {
		...identity,
		status: pointer.status,
		scripts: revision.scripts,
		manifest: revision.manifest,
		sourceHash: revision.sourceHash,
	} satisfies StoredPlugin;
};

export class PluginRepository extends Context.Service<PluginRepository>()("PluginRepository", {
	make: Effect.gen(function* () {
		const database = yield* DatabaseSession;
		const loadRevisions = loadRevisionsForSession(database);
		const lookupRevision = lookupRevisionForSession(loadRevisions);
		const configs = yield* PluginConfigRevisions;
		const definitions = yield* DefinitionRepository;
		const artifacts = yield* ClientArtifactsRepository;
		const lockIngestion = Effect.fn("PluginRepository.lockIngestion")(function* () {
			yield* database.run((db) =>
				db.execute(
					sql`select pg_advisory_xact_lock(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
				),
			);
		});

		const lockIngestionShared = Effect.fn("PluginRepository.lockIngestionShared")(function* () {
			yield* database.run((db) =>
				db.execute(
					sql`select pg_advisory_xact_lock_shared(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
				),
			);
		});

		const toStoredPlugins = Effect.fn(function* (rows: ReadonlyArray<PluginPointerRow>) {
			const revisions = yield* loadRevisions(
				rows.flatMap(({ activeRevisionId }) => (activeRevisionId ? [activeRevisionId] : [])),
			);
			const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));
			return yield* Effect.forEach(rows, (row) => {
				const revision = row.activeRevisionId ? revisionsById.get(row.activeRevisionId) : undefined;
				return revision
					? Effect.succeed(toStoredPlugin(row, revision))
					: new DbError({ message: `Plugin ${row.slug} has no retained active revision` });
			});
		});

		const activeSystem = and(eq(schema.plugin.status, "active"), isNull(schema.plugin.ownerId));

		const listActiveSystemPlugins = Effect.fn("PluginRepository.listActiveSystemPlugins")(
			function* () {
				const rows = yield* database.run((db) =>
					db
						.select(pluginPointerFields)
						.from(schema.plugin)
						.where(activeSystem)
						.orderBy(asc(schema.plugin.slug)),
				);
				return yield* toStoredPlugins(rows);
			},
		);

		const findActiveSystemPlugin = Effect.fn("PluginRepository.findActiveSystemPlugin")(function* (
			slug: string,
		) {
			const rows = yield* database.run((db) =>
				db
					.select(pluginPointerFields)
					.from(schema.plugin)
					.where(and(activeSystem, eq(schema.plugin.slug, slug)))
					.limit(1),
			);
			const [plugin] = yield* toStoredPlugins(rows);
			return plugin ?? null;
		});

		const listActiveSystemSlugs = Effect.fn("PluginRepository.listActiveSystemSlugs")(function* () {
			const rows = yield* database.run((db) =>
				db
					.select({ slug: schema.plugin.slug })
					.from(schema.plugin)
					.where(activeSystem)
					.orderBy(asc(schema.plugin.slug)),
			);
			return rows.map(({ slug }) => slug);
		});

		const listActiveHttpRateLimits = Effect.fn("PluginRepository.listActiveHttpRateLimits")(
			function* () {
				return yield* database.run((db) =>
					db
						.select({
							slug: schema.plugin.slug,
							httpRateLimits: sql<
								ReadonlyArray<PluginHttpRateLimit>
							>`${schema.pluginRevision.manifest} -> 'httpRateLimits'`,
						})
						.from(schema.plugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(activeSystem)
						.orderBy(asc(schema.plugin.slug)),
				);
			},
		);

		const findKernelScript = Effect.fn("PluginRepository.findKernelScript")(function* (
			slug: string,
		) {
			const [row] = yield* database.run((db) =>
				db
					.select(storedScriptFields)
					.from(schema.kernelScript)
					.innerJoin(
						schema.sandboxScript,
						eq(schema.sandboxScript.id, schema.kernelScript.scriptId),
					)
					.where(eq(schema.kernelScript.slug, slug))
					.limit(1),
			);
			return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
		});

		const listPrivateForUser = Effect.fn("PluginRepository.listPrivateForUser")(function* (
			userId: string,
		) {
			const rows = yield* database.run((db) =>
				db
					.select(pluginPointerFields)
					.from(schema.plugin)
					.where(
						and(
							eq(schema.plugin.status, "active"),
							isNotNull(schema.plugin.ownerId),
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
			const [row] = yield* database.run((db) =>
				db
					.select(pluginPointerFields)
					.from(schema.plugin)
					.where(
						and(
							eq(schema.plugin.id, pluginId),
							eq(schema.plugin.status, "active"),
							isNotNull(schema.plugin.ownerId),
							eq(schema.plugin.ownerId, userId),
						),
					)
					.limit(1),
			);
			if (!row?.activeRevisionId) {
				return null;
			}
			return toStoredPlugin(row, yield* lookupRevision(row.activeRevisionId));
		});

		const listPortablePluginMetadata = Effect.fn("PluginRepository.listPortablePluginMetadata")(
			function* () {
				const rows = yield* database.run((db) =>
					db
						.select({
							id: schema.plugin.id,
							slug: schema.plugin.slug,
							activeRevisionId: schema.plugin.activeRevisionId,
						})
						.from(schema.plugin)
						.where(activeSystem)
						.orderBy(asc(schema.plugin.slug)),
				);
				const revisionsById = new Map(
					(yield* loadRevisions(
						rows.flatMap(({ activeRevisionId }) => (activeRevisionId ? [activeRevisionId] : [])),
					)).map((revision) => [revision.id, revision]),
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
				const [row] = yield* database.run((db) =>
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
				const [row] = yield* database.run((db) =>
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
				const [row] = yield* database.run((db) =>
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
				const [relationship] = yield* database.run((db) =>
					db
						.select({ id: schema.relationship.id })
						.from(schema.relationship)
						.where(eq(schema.relationship.relationshipSchemaPluginId, pluginId))
						.limit(1),
				);
				if (relationship) {
					return true;
				}

				const [subscription] = yield* database.run((db) =>
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
			const [row] = yield* database.run((db) =>
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
			return toStoredPlugin(row, yield* lookupRevision(row.activeRevisionId));
		});

		const findTestSupportOperationResult = Effect.fn(
			"PluginRepository.findTestSupportOperationResult",
		)(function* (
			identity:
				| PluginPersistenceIdentity
				| { readonly pluginId: string; readonly ownerId: string; readonly scope: "user" },
		) {
			const [plugin] = yield* database.run((db) =>
				db
					.select({ id: schema.plugin.id, activeRevisionId: schema.plugin.activeRevisionId })
					.from(schema.plugin)
					.where(
						and(
							"pluginId" in identity
								? eq(schema.plugin.id, identity.pluginId)
								: eq(schema.plugin.slug, identity.slug),
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
			const scripts = yield* database.run((db) =>
				db
					.select({ id: schema.sandboxScript.id, slug: schema.sandboxScript.slug })
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
					configRevisionId: null,
				};
			}
			const [installation] = yield* database.run((db) =>
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
			if (!installation) {
				return null;
			}
			return {
				...plugin,
				scripts,
				activeRevisionId,
				installationId: installation.id,
				configRevisionId: installation.configRevisionId,
			};
		});

		const isActiveRevision = Effect.fn("PluginRepository.isActiveRevision")(function* (input: {
			readonly pluginId: string;
			readonly sourceHash: string;
		}) {
			const [row] = yield* database.run((db) =>
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
			const rows = yield* database.run((db) =>
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
		const listRevisionSourceFiles = Effect.fn("PluginRepository.listRevisionSourceFiles")(
			function* (revisionId: string) {
				const rows = yield* database.run((db) =>
					db
						.select({
							path: schema.pluginRevisionSourceFile.path,
							contents: schema.pluginRevisionSourceFile.contents,
						})
						.from(schema.pluginRevisionSourceFile)
						.where(eq(schema.pluginRevisionSourceFile.pluginRevisionId, revisionId))
						.orderBy(asc(schema.pluginRevisionSourceFile.path)),
				);
				return Object.fromEntries(
					rows.map(({ path, contents }) => [path, new Uint8Array(contents)]),
				);
			},
		);
		const listCompiledPackageArtifacts = Effect.fn("PluginRepository.listCompiledPackageArtifacts")(
			function* (pluginId: string) {
				const [revision] = yield* database.run((db) =>
					db
						.select({
							id: schema.pluginRevision.id,
							manifest: schema.pluginRevision.manifest,
							sourceHash: schema.pluginRevision.sourceHash,
							clientArtifactHash: schema.pluginRevision.clientArtifactHash,
						})
						.from(schema.plugin)
						.innerJoin(
							schema.pluginRevision,
							eq(schema.pluginRevision.id, schema.plugin.activeRevisionId),
						)
						.where(and(eq(schema.plugin.id, pluginId), eq(schema.plugin.status, "active")))
						.limit(1),
				);
				if (!revision) {
					return yield* new DbError({ message: `Plugin ${pluginId} has no active revision` });
				}
				const manifest = yield* decodeStoredManifest(revision.manifest, pluginId);
				const files = yield* listRevisionSourceFiles(revision.id);
				const scriptRows = yield* database.run((db) =>
					db
						.select({
							slug: schema.sandboxScript.slug,
							format: schema.sandboxScript.compiledFormat,
							javascript: schema.sandboxScript.compiledCode,
						})
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.pluginRevisionId, revision.id)),
				);
				const scriptsBySlug = new Map(scriptRows.map((script) => [script.slug, script]));
				if (
					scriptsBySlug.size !== scriptRows.length ||
					scriptRows.length !== manifest.scripts.length
				) {
					return yield* new DbError({
						message: `Plugin ${pluginId} has incomplete retained compiled scripts`,
					});
				}
				const compiledScripts = yield* Effect.forEach(manifest.scripts, (script) => {
					const retained = scriptsBySlug.get(script.slug);
					if (!retained) {
						return Effect.fail(
							new DbError({
								message: `Plugin ${pluginId} is missing compiled script ${script.slug}`,
							}),
						);
					}
					const source = files[script.entry];
					if (!source) {
						return Effect.fail(
							new DbError({ message: `Plugin ${pluginId} is missing source file ${script.entry}` }),
						);
					}
					return Effect.try({
						catch: () =>
							new DbError({
								message: `Plugin ${pluginId} has invalid source file ${script.entry}`,
							}),
						try: () => ({
							entry: script.entry,
							format: retained.format,
							javascript: retained.javascript,
							source: new TextDecoder("utf-8", { fatal: true }).decode(source),
						}),
					});
				});

				const normalizeRetainedArtifacts = (compiledClient?: PluginClientArtifact) =>
					normalizePluginSource({
						files,
						manifest,
						compiledScripts,
						...(compiledClient ? { compiledClient } : {}),
					}).pipe(
						Effect.mapError(
							(error) =>
								new DbError({
									message: `Plugin ${pluginId} has invalid retained artifacts: ${error.issues.join("; ")}`,
								}),
						),
					);

				const compiledClient = revision.clientArtifactHash
					? yield* artifacts.loadClientArtifact(revision.clientArtifactHash)
					: undefined;
				if (
					compiledClient &&
					clientArtifactMetadata(manifest.metadata.name, compiledClient.files).hash !==
						compiledClient.hash
				) {
					return yield* new DbError({
						message: `Plugin ${pluginId} retained client artifact hash does not match its contents`,
					});
				}
				if (!manifest.client) {
					const normalized = yield* normalizeRetainedArtifacts(compiledClient);
					if (normalized.sourceHash !== revision.sourceHash) {
						return yield* new DbError({
							message: `Plugin ${pluginId} retained package hash does not match its artifacts`,
						});
					}
					return { compiledScripts };
				}

				if (!compiledClient) {
					return yield* new DbError({
						message: `Plugin ${pluginId} is missing its retained compiled client artifact`,
					});
				}
				const normalized = yield* normalizeRetainedArtifacts(compiledClient);
				if (normalized.sourceHash !== revision.sourceHash) {
					return yield* new DbError({
						message: `Plugin ${pluginId} retained package hash does not match its artifacts`,
					});
				}
				return { compiledClient, compiledScripts };
			},
		);
		const findRevisionClientArtifact = Effect.fn("PluginRepository.findRevisionClientArtifact")(
			function* (revisionId: string) {
				const [revision] = yield* database.run((db) =>
					db
						.select({
							pluginSlug: schema.plugin.slug,
							manifest: schema.pluginRevision.manifest,
							clientArtifactHash: schema.pluginRevision.clientArtifactHash,
						})
						.from(schema.pluginRevision)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginRevision.pluginId))
						.where(eq(schema.pluginRevision.id, revisionId))
						.limit(1),
				);
				if (!revision?.clientArtifactHash) {
					return null;
				}
				const manifest = yield* decodeStoredManifest(revision.manifest, revision.pluginSlug);
				if (!manifest.client) {
					return yield* new DbError({
						message: `Plugin ${revision.pluginSlug} has a client artifact without a client manifest`,
					});
				}
				const artifact = yield* artifacts.loadClientArtifact(revision.clientArtifactHash);
				if (clientArtifactMetadata(manifest.metadata.name, artifact.files).hash !== artifact.hash) {
					return yield* new DbError({
						message: `Plugin ${revision.pluginSlug} retained client artifact hash does not match its contents`,
					});
				}
				return artifact;
			},
		);
		const findClientArtifactForSource = Effect.fn("PluginRepository.findClientArtifactForSource")(
			function* (input: { readonly pluginId: string; readonly sourceHash: string }) {
				const [revision] = yield* database.run((db) =>
					db
						.select({ id: schema.pluginRevision.id })
						.from(schema.pluginRevision)
						.where(
							and(
								eq(schema.pluginRevision.pluginId, input.pluginId),
								eq(schema.pluginRevision.sourceHash, input.sourceHash),
							),
						)
						.limit(1),
				);
				return revision ? yield* findRevisionClientArtifact(revision.id) : null;
			},
		);

		const listAuthorizedSourceFiles = Effect.fn("PluginRepository.listAuthorizedSourceFiles")(
			function* (input: {
				readonly userId: string;
				readonly pluginId: string;
				readonly sourceHash: string;
				readonly installationId: string;
			}) {
				const [authorized] = yield* database.run((db) =>
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

		const persistKernelScript = Effect.fn("PluginRepository.persistKernelScript")(function* (
			script: PersistedScript,
		) {
			yield* database.run((db) =>
				db
					.insert(schema.sandboxScript)
					.values({ ...script, pluginRevisionId: null })
					.onConflictDoNothing(),
			);
			const [existing] = yield* database.run((db) =>
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
			yield* database.run((db) =>
				db
					.insert(schema.kernelScript)
					.values({ slug: script.slug, scriptId: existing.id })
					.onConflictDoUpdate({ set: { scriptId: existing.id }, target: schema.kernelScript.slug }),
			);
			return undefined;
		});

		const persist = Effect.fn("PluginRepository.persist")(function* (
			plugin: NormalizedPlugin,
			identity: PluginPersistenceIdentity,
		) {
			const slug = identity.slug;
			const mutation = { status: "installing" } as const;
			const [inserted] = yield* database.run((db) =>
				db
					.insert(schema.plugin)
					.values({ ...mutation, slug, ownerId: identity.ownerId })
					.onConflictDoNothing()
					.returning({ id: schema.plugin.id }),
			);
			const [persisted] = inserted
				? [inserted]
				: yield* database.run((db) =>
						db
							.update(schema.plugin)
							.set(mutation)
							.where(
								and(
									eq(schema.plugin.slug, slug),
									identity.ownerId === null
										? isNull(schema.plugin.ownerId)
										: eq(schema.plugin.ownerId, identity.ownerId),
								),
							)
							.returning({ id: schema.plugin.id }),
					);
			if (!persisted) {
				return yield* new DbError({ message: `Plugin ${slug} could not be persisted` });
			}
			const pluginId = persisted.id;
			const [existingRevision] = yield* database.run((db) =>
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
			const clientArtifactHash = plugin.compiledClient?.hash ?? null;
			if (existingRevision && existingRevision.clientArtifactHash !== clientArtifactHash) {
				return yield* new DbError({
					message: "Immutable plugin revision conflicts with stored client artifact",
				});
			}
			if (plugin.compiledClient) {
				if (
					clientArtifactMetadata(plugin.manifest.metadata.name, plugin.compiledClient.files)
						.hash !== plugin.compiledClient.hash
				) {
					return yield* new DbError({
						message: "Plugin client artifact metadata hash does not match its contents",
					});
				}
				yield* artifacts.persistClientArtifact(plugin.compiledClient);
			}
			const [insertedRevision] = existingRevision
				? []
				: yield* database.run((db) =>
						db
							.insert(schema.pluginRevision)
							.values({
								pluginId,
								clientArtifactHash,
								manifest: plugin.manifest,
								sourceHash: plugin.sourceHash,
								clientConfigSchema: redactPluginConfig(plugin.manifest.configSchema, {})
									.configSchema,
							})
							.returning(),
					);
			const revision = existingRevision ?? insertedRevision;
			if (!revision) {
				return yield* new DbError({ message: "Plugin revision could not be persisted" });
			}
			const pluginRevisionId = revision.id;
			if (insertedRevision) {
				yield* definitions.writeRevisionDefinitions({
					pluginRevisionId,
					definitions: yield* Effect.try({
						catch: (error) => new DbError({ message: String(error) }),
						try: () => revisionDefinitions(pluginId, slug, plugin.manifest),
					}),
				});
			}
			const sourceEntries = Object.entries(plugin.files);
			const retainedFiles = yield* database.run((db) =>
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
				yield* database.run((db) =>
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
			const providers =
				plugin.manifest.providers.length > 0
					? yield* database.run((db) =>
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
			if (plugin.scripts.length > 0) {
				yield* Effect.forEach(
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
							const [retained] = yield* database.run((db) =>
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
							} else {
								yield* database.run((db) =>
									db
										.insert(schema.sandboxScript)
										.values({
											source: null,
											pluginRevisionId,
											slug: script.slug,
											name: script.name,
											metadata: script.metadata,
											providerId: providerId ?? null,
											contentHash: script.contentHash,
											compiledCode: script.compiledCode,
											compiledFormat: script.compiledFormat,
										}),
								);
							}
							return undefined;
						}),
					{ discard: true },
				);
			}
			yield* database.run((db) =>
				db
					.update(schema.plugin)
					.set({
						status: "active",
						activeRevisionId: pluginRevisionId,
						environmentConfigRevisionId: sql`case when ${schema.plugin.activeRevisionId} = ${pluginRevisionId} then ${schema.plugin.environmentConfigRevisionId} end`,
					})
					.where(eq(schema.plugin.id, pluginId)),
			);
			return pluginId;
		});

		const setEnvironmentConfigRevision = Effect.fn("PluginRepository.setEnvironmentConfigRevision")(
			function* (pluginId: string, configRevisionId: string) {
				yield* database.run((db) =>
					db
						.update(schema.plugin)
						.set({ environmentConfigRevisionId: configRevisionId })
						.where(eq(schema.plugin.id, pluginId)),
				);
			},
		);

		const resolveEnvironmentConfig = Effect.fn("PluginRepository.resolveEnvironmentConfig")(
			function* (plugin: Pick<StoredPlugin, "id" | "manifest" | "slug">) {
				const [row] = yield* database.run((db) =>
					db
						.select({ activeRevisionId: schema.plugin.activeRevisionId })
						.from(schema.plugin)
						.where(eq(schema.plugin.id, plugin.id))
						.limit(1),
				);
				if (!row?.activeRevisionId) {
					return yield* new DbError({ message: `Plugin ${plugin.slug} has no active revision` });
				}
				const configRevisionId = yield* configs.resolveEnvironment({
					pluginId: plugin.id,
					pluginSlug: plugin.slug,
					pluginRevisionId: row.activeRevisionId,
					configSchema: plugin.manifest.configSchema,
				});
				yield* setEnvironmentConfigRevision(plugin.id, configRevisionId);
				yield* Effect.logInfo(
					`Resolved environment configuration ${configRevisionId} for plugin ${plugin.slug}`,
				);
				return configRevisionId;
			},
		);

		const deactivate = Effect.fn("PluginRepository.deactivate")(function* (pluginId: string) {
			yield* database.run((db) =>
				db.update(schema.plugin).set({ status: "inactive" }).where(eq(schema.plugin.id, pluginId)),
			);
		});

		const deleteInactiveUnreferencedPlugins = Effect.fn(
			"PluginRepository.deleteInactiveUnreferencedPlugins",
		)(function* (limit: number) {
			return yield* database.run((db) => {
				const candidates = db
					.select({ id: schema.plugin.id })
					.from(schema.plugin)
					.where(
						and(
							isNotNull(schema.plugin.ownerId),
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
									.where(
										eq(schema.notificationSubscription.signalSchemaPluginId, schema.plugin.id),
									),
							),
							notExists(
								db
									.select({ executionId: schema.sandboxWorkflowReference.executionId })
									.from(schema.sandboxWorkflowReference)
									.innerJoin(
										schema.sandboxScript,
										eq(schema.sandboxWorkflowReference.scriptId, schema.sandboxScript.id),
									)
									.innerJoin(
										schema.pluginRevision,
										eq(schema.sandboxScript.pluginRevisionId, schema.pluginRevision.id),
									)
									.where(eq(schema.pluginRevision.pluginId, schema.plugin.id)),
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
				return db
					.delete(schema.plugin)
					.where(inArray(schema.plugin.id, candidates))
					.returning({ id: schema.plugin.id });
			});
		});

		const deleteUnreferencedScripts = Effect.fn("PluginRepository.deleteUnreferencedScripts")(
			function* (liveContentHashes: ReadonlySet<string>, input: { now: Date; limit: number }) {
				return yield* database.run((db) => {
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
										.select({ slug: schema.kernelScript.slug })
										.from(schema.kernelScript)
										.where(eq(schema.kernelScript.scriptId, schema.sandboxScript.id)),
								),
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
					return db
						.delete(schema.sandboxScript)
						.where(inArray(schema.sandboxScript.id, candidates))
						.returning({
							id: schema.sandboxScript.id,
							contentHash: schema.sandboxScript.contentHash,
						});
				});
			},
		);

		const listPersistedLivenessContentHashes = Effect.fn(
			"PluginRepository.listPersistedLivenessContentHashes",
		)(function* (now: Date) {
			const rows = yield* database.run((db) =>
				db
					.select({ contentHash: schema.sandboxScript.contentHash })
					.from(schema.sandboxScript)
					.where(
						or(
							exists(
								db
									.select({ slug: schema.kernelScript.slug })
									.from(schema.kernelScript)
									.where(eq(schema.kernelScript.scriptId, schema.sandboxScript.id)),
							),
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
			persist,
			deactivate,
			lockIngestion,
			listSourceFiles,
			findKernelScript,
			findBySourceHash,
			isActiveRevision,
			listPrivateForUser,
			lockIngestionShared,
			persistKernelScript,
			hasEntityReferences,
			listActiveSystemSlugs,
			findActiveSystemPlugin,
			resolveProviderBySlugs,
			findPrivateByIdForUser,
			listActiveSystemPlugins,
			hasDefinitionReferences,
			listRevisionSourceFiles,
			resolveEnvironmentConfig,
			listActiveHttpRateLimits,
			hasIntegrationReferences,
			listAuthorizedSourceFiles,
			deleteUnreferencedScripts,
			listPortablePluginMetadata,
			findRevisionClientArtifact,
			findClientArtifactForSource,
			listCompiledPackageArtifacts,
			setEnvironmentConfigRevision,
			findTestSupportOperationResult,
			deleteInactiveUnreferencedPlugins,
			listPersistedLivenessContentHashes,
			validateConfigurationKeys: configs.validateKeys,
			// Ordered by `plugin.id` so the per-plugin advisory locks match `lockCatalog`.
			resolveEnvironmentConfigs: Effect.fn("PluginRepository.resolveEnvironmentConfigs")(
				function* () {
					for (const plugin of yield* listActiveSystemPlugins()) {
						yield* resolveEnvironmentConfig(plugin);
					}
				},
			),
			pruneRevisionArtifacts: Effect.fn("PluginRepository.pruneRevisionArtifacts")(
				function* (input: { now: Date; limit: number; retryWindowDays: number }) {
					yield* database.run((db) =>
						db.execute(sql`with candidates as (
					select i.id from plugin_installation i where i.uninstalled_at <= ${input.now} - ${input.retryWindowDays} * interval '1 day'
					and not exists (select 1 from sandbox_workflow_reference w where w.plugin_installation_id = i.id)
					and not exists (select 1 from automation_run r join plugin_config_revision c on c.id = r.plugin_config_revision_id where c.plugin_installation_id = i.id and (r.status in ('queued', 'running') or r.artifacts_expire_at > ${input.now}))
					limit ${input.limit}
				) delete from plugin_installation where id in (select id from candidates)`),
					);
					yield* database.run((db) =>
						db.execute(sql`with candidates as (
					select c.id from plugin_config_revision c
					where c.encrypted_payload is not null
					and not exists (select 1 from plugin_installation i where i.active_config_revision_id = c.id and i.uninstalled_at is null)
					and c.owner_user_id is not null
					and not exists (select 1 from automation_run r where r.plugin_config_revision_id = c.id and (r.status in ('queued', 'running') or r.artifacts_expire_at > ${input.now}))
					and not exists (select 1 from sandbox_workflow_reference w join sandbox_script s on s.id = w.script_id join plugin_revision r on r.id = s.plugin_revision_id where w.plugin_installation_id = c.plugin_installation_id or r.plugin_id = (select plugin_id from plugin_revision where id = c.plugin_revision_id))
					limit ${input.limit}
				) update plugin_config_revision set encrypted_payload = null, payload_pruned_at = ${input.now} where id in (select id from candidates)`),
					);
					yield* database.run((db) =>
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
		Layer.provide(
			Layer.mergeAll(
				PluginConfigRevisions.layer,
				DefinitionRepository.layer,
				ClientArtifactsRepository.layer,
			),
		),
	);
}
