import type { PluginClientArtifact } from "@ryot-app/client-plugin-contract";
import { DbError } from "@ryot-app/contract/errors";
import type { PluginProviderOperation } from "@ryot-app/contract/modules/plugins/manifest";
import { SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, exists, inArray, isNull, notExists, notInArray, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import type {
	NormalizedPlugin,
	NormalizedPluginScript,
	PluginPersistenceIdentity,
	StoredPlugin,
	StoredPluginIdentity,
} from "./types";

type PluginRow = typeof schema.plugin.$inferSelect;
type ScriptRow = typeof schema.sandboxScript.$inferSelect;
type ClientArtifactRow = typeof schema.pluginClientArtifact.$inferSelect;
type ClientArtifactFileRow = typeof schema.pluginClientArtifactFile.$inferSelect;

type PersistedScript = Omit<NormalizedPluginScript, "entry">;

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
	let identity: StoredPluginIdentity | null = null;
	if (row.scope === "system" && row.ownerId === null) {
		identity = { id: row.id, slug: row.slug, ownerId: null, scope: "system" };
	} else if (row.scope === "user" && row.ownerId !== null) {
		identity = { id: row.id, slug: row.slug, ownerId: row.ownerId, scope: "user" };
	}
	if (!identity) {
		return yield* new DbError({ message: `Plugin ${row.slug} has invalid persisted identity` });
	}
	return {
		...identity,
		status: row.status,
		manifest: row.manifest,
		scripts: currentScripts,
		sourceHash: row.sourceHash,
	} satisfies StoredPlugin;
});

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
			const pluginIds = rows.map(({ id }) => id);
			return yield* mapDatabaseErrors(
				db
					.select()
					.from(schema.sandboxScript)
					.where(inArray(schema.sandboxScript.pluginId, pluginIds)),
			);
		});

		const toStoredPlugins = Effect.fn(function* (rows: ReadonlyArray<PluginRow>) {
			const scripts = yield* loadScripts(rows);
			return yield* Effect.forEach(rows, (row) =>
				toStoredPlugin(
					row,
					scripts.filter(({ pluginId }) => pluginId === row.id),
				),
			);
		});

		const list = Effect.fn("PluginRepository.list")(function* () {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select()
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
					.select()
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
					.select()
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
			if (!row) {
				return null;
			}
			const scripts = yield* loadScripts([row]);
			return yield* toStoredPlugin(row, scripts);
		});

		const listActiveManifests = Effect.fn("PluginRepository.listActiveManifests")(function* () {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select({ manifest: schema.plugin.manifest })
					.from(schema.plugin)
					.where(and(eq(schema.plugin.status, "active"), eq(schema.plugin.scope, "system"))),
			);
			return rows.map(({ manifest }) => manifest);
		});

		const listPortablePluginMetadata = Effect.fn("PluginRepository.listPortablePluginMetadata")(
			function* () {
				const db = yield* Database;
				return yield* mapDatabaseErrors(
					db
						.select({
							id: schema.plugin.id,
							slug: schema.plugin.slug,
							version: schema.plugin.version,
							sourceHash: schema.plugin.sourceHash,
							manifestMetadata: schema.plugin.manifest,
						})
						.from(schema.plugin)
						.where(and(eq(schema.plugin.status, "active"), eq(schema.plugin.scope, "system")))
						.orderBy(asc(schema.plugin.slug)),
				).pipe(
					Effect.map((rows) =>
						rows.map(({ manifestMetadata: manifest, id, slug, version, sourceHash }) => ({
							id,
							slug,
							version,
							sourceHash,
							client: manifest.client,
							metadata: manifest.metadata,
							configSchema: manifest.configSchema,
							integrationProviders: manifest.integrationProviders,
							signalSchemaSlugs: manifest.signalSchemas.map(
								({ slug: signalSchemaSlug }) => signalSchemaSlug,
							),
							relationshipSchemaSlugs: manifest.relationshipSchemas.map(
								({ slug: relationshipSchemaSlug }) => relationshipSchemaSlug,
							),
						})),
					),
				);
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

				const [signal] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.signal.id })
						.from(schema.signal)
						.where(eq(schema.signal.signalSchemaPluginId, pluginId))
						.limit(1),
				);
				if (signal) {
					return true;
				}

				const [subscription] = yield* mapDatabaseErrors(
					db
						.select({ id: schema.notificationSubscriptionState.id })
						.from(schema.notificationSubscriptionState)
						.where(eq(schema.notificationSubscriptionState.signalSchemaPluginId, pluginId))
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
					.select()
					.from(schema.plugin)
					.where(
						and(
							eq(schema.plugin.slug, input.slug),
							eq(schema.plugin.scope, input.scope),
							eq(schema.plugin.status, "active"),
							eq(schema.plugin.sourceHash, input.sourceHash),
							input.ownerId === null
								? isNull(schema.plugin.ownerId)
								: eq(schema.plugin.ownerId, input.ownerId),
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

		const isActiveRevision = Effect.fn("PluginRepository.isActiveRevision")(function* (input: {
			readonly pluginId: string;
			readonly sourceHash: string;
		}) {
			const db = yield* Database;
			const [row] = yield* mapDatabaseErrors(
				db
					.select({ id: schema.plugin.id })
					.from(schema.plugin)
					.where(
						and(
							eq(schema.plugin.id, input.pluginId),
							eq(schema.plugin.status, "active"),
							eq(schema.plugin.sourceHash, input.sourceHash),
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
						path: schema.pluginSourceFile.path,
						contents: schema.pluginSourceFile.contents,
					})
					.from(schema.pluginSourceFile)
					.where(eq(schema.pluginSourceFile.pluginId, pluginId))
					.orderBy(asc(schema.pluginSourceFile.path)),
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
						.where(
							and(
								eq(schema.plugin.id, input.pluginId),
								eq(schema.plugin.status, "active"),
								eq(schema.plugin.sourceHash, input.sourceHash),
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
			const [existing] = yield* mapDatabaseErrors(
				db
					.select({ id: schema.sandboxScript.id })
					.from(schema.sandboxScript)
					.where(
						and(
							eq(schema.sandboxScript.slug, script.slug),
							eq(schema.sandboxScript.contentHash, script.contentHash),
							isNull(schema.sandboxScript.pluginId),
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
						pluginId: null,
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

		const persist = Effect.fn("PluginRepository.persist")(function* (
			plugin: NormalizedPlugin,
			identity: PluginPersistenceIdentity,
		) {
			const db = yield* Database;
			const slug = identity.slug;
			const compiledHashes = Object.fromEntries(
				plugin.scripts.map((script) => [script.slug, script.contentHash]),
			);
			const mutation = {
				compiledHashes,
				status: "active",
				manifest: plugin.manifest,
				sourceHash: plugin.sourceHash,
				version: plugin.manifest.metadata.version,
			} as const;
			const conflict =
				identity.scope === "system"
					? {
							target: schema.plugin.slug,
							targetWhere: sql`${schema.plugin.scope} = 'system'`,
							set: { ...mutation, ingestedAt: sql`now()` },
						}
					: {
							target: [schema.plugin.ownerId, schema.plugin.slug],
							targetWhere: sql`${schema.plugin.scope} = 'user'`,
							set: { ...mutation, ingestedAt: sql`now()` },
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
			yield* mapDatabaseErrors(
				db.delete(schema.pluginSourceFile).where(eq(schema.pluginSourceFile.pluginId, pluginId)),
			);
			const sourceEntries = Object.entries(plugin.files);
			if (sourceEntries.length > 0) {
				yield* mapDatabaseErrors(
					db
						.insert(schema.pluginSourceFile)
						.values(
							sourceEntries.map(([path, contents]) => ({
								path,
								pluginId,
								contents: Buffer.from(contents),
							})),
						),
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
					(script) => {
						const providerSlug =
							"providerSlug" in script.metadata ? script.metadata.providerSlug : undefined;
						const providerId = providerSlug ? providerIdBySlug.get(providerSlug) : undefined;
						if (providerSlug && !providerId) {
							return Effect.fail(
								new DbError({ message: `Plugin ${slug} is missing provider ${providerSlug}` }),
							);
						}
						return mapDatabaseErrors(
							db
								.insert(schema.sandboxScript)
								.values({
									pluginId,
									slug: script.slug,
									name: script.name,
									source: script.source,
									metadata: script.metadata,
									providerId: providerId ?? null,
									contentHash: script.contentHash,
									compiledCode: script.compiledCode,
									compiledFormat: script.compiledFormat,
								})
								.onConflictDoUpdate({
									target: [
										schema.sandboxScript.pluginId,
										schema.sandboxScript.slug,
										schema.sandboxScript.contentHash,
									],
									set: {
										updatedAt: sql`now()`,
										metadata: script.metadata,
										providerId: providerId ?? null,
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
		)(function* () {
			const db = yield* Database;
			return yield* mapDatabaseErrors(
				db
					.delete(schema.plugin)
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
									.select({ id: schema.signal.id })
									.from(schema.signal)
									.where(eq(schema.signal.signalSchemaPluginId, schema.plugin.id)),
							),
							notExists(
								db
									.select({ id: schema.notificationSubscriptionState.id })
									.from(schema.notificationSubscriptionState)
									.where(
										eq(schema.notificationSubscriptionState.signalSchemaPluginId, schema.plugin.id),
									),
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
					.returning({ id: schema.plugin.id }),
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
		)(function* () {
			const db = yield* Database;
			const rows = yield* mapDatabaseErrors(
				db
					.select({ contentHash: schema.sandboxScript.contentHash })
					.from(schema.sandboxScript)
					.where(
						or(
							isNull(schema.sandboxScript.pluginId),
							exists(
								db
									.select({ id: schema.plugin.id })
									.from(schema.plugin)
									.where(
										and(
											eq(schema.plugin.id, schema.sandboxScript.pluginId),
											eq(schema.plugin.status, "active"),
										),
									),
							),
							exists(
								db
									.select({ scriptId: schema.sandboxWorkflowReference.scriptId })
									.from(schema.sandboxWorkflowReference)
									.where(eq(schema.sandboxWorkflowReference.scriptId, schema.sandboxScript.id)),
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
			lockIngestion,
			listSourceFiles,
			findBySourceHash,
			isActiveRevision,
			listPrivateForUser,
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
			deleteInactiveUnreferencedPlugins,
			listPersistedLivenessContentHashes,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
