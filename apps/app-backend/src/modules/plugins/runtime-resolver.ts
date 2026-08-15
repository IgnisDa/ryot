import type { DbError } from "@ryot/contract/errors";
import type {
	AutomationOperation,
	AutomationRuleKind,
	AutomationRuleMetadata,
} from "@ryot/contract/modules/automations/schemas";
import type { PluginProviderOperation } from "@ryot/contract/modules/plugins/manifest";
import type { ExecutionAuthority } from "@ryot/contract/modules/sandbox/schemas";
import type { UserId } from "@ryot/contract/schema/brands";
import {
	AutomationRuleId,
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	SignalSchemaSlug,
} from "@ryot/contract/schema/brands";
import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import type { PluginConfigContext } from "#lib/infrastructure/sandbox-runtime/app-config";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	type DefinitionSnapshot,
} from "#modules/definition-registry/service";

import { PluginInstallationRepository } from "./installation-repository";
import {
	findPluginEntryById,
	mergeManifestDefinitions,
	PluginLoader,
	PluginLoaderLive,
	type PluginRegistrySnapshot,
} from "./loader";

export type AutomationRuleTarget =
	| { kind: "event_schema"; id: EventSchemaSlug }
	| { kind: "entity_schema"; id: EntitySchemaSlug }
	| { kind: "signal_schema"; id: SignalSchemaSlug }
	| { kind: "relationship_schema"; id: RelationshipSchemaSlug };

type BindingAutomation = {
	name: string;
	pluginSlug: string;
	scriptSlug: string;
	position: number | null;
	kind: AutomationRuleKind;
	target: AutomationRuleTarget;
	operation: AutomationOperation;
	metadata: AutomationRuleMetadata | null;
};

export type ResolvedAutomationRule = {
	name: string;
	isActive: boolean;
	isBuiltin: boolean;
	userId: UserId | null;
	id: AutomationRuleId;
	position: number | null;
	kind: AutomationRuleKind;
	target: AutomationRuleTarget;
	operation: AutomationOperation;
	sandboxScriptId: SandboxScriptId;
	metadata: AutomationRuleMetadata | null;
};

export class UnsupportedProviderOperationError extends Data.TaggedError(
	"UnsupportedProviderOperationError",
)<{
	readonly providerId: SandboxProviderId;
	readonly providerSlug: string | null;
	readonly operation: PluginProviderOperation;
	readonly reason: "inactive_provider" | "unsupported_operation" | "script_unavailable";
}> {}

export class InvalidProviderEntityImportAutomationError extends Data.TaggedError(
	"InvalidProviderEntityImportAutomationError",
)<{
	readonly pluginSlug: string;
	readonly scriptSlug: string;
	readonly reason: "missing_script" | "wrong_script_kind" | "inactive_script";
}> {}

export type ResolvedProviderEntityImportAutomation = {
	readonly ruleId: AutomationRuleId;
	readonly sandboxScriptId: SandboxScriptId;
};

const bindingId = (binding: BindingAutomation) =>
	AutomationRuleId.make(
		[
			"binding",
			binding.pluginSlug,
			binding.kind,
			binding.target.kind,
			binding.target.id,
			binding.operation,
			binding.scriptSlug,
		].join(":"),
	);

const providerEntityImportBindingId = (input: {
	index: number;
	pluginSlug: string;
	scriptSlug: string;
	entitySchemaSlug: string;
}) =>
	AutomationRuleId.make(
		[
			"binding",
			input.pluginSlug,
			"provider_entity_import",
			input.entitySchemaSlug,
			input.scriptSlug,
			input.index,
		].join(":"),
	);

const activeScripts = (snapshot: PluginRegistrySnapshot) =>
	Object.values(snapshot.plugins).flatMap((plugin) =>
		plugin.scripts.map((script) => ({ ...script, pluginId: plugin.id, pluginSlug: plugin.slug })),
	);

export const findActiveScriptInPluginSnapshot = Effect.fn(
	"PluginRuntimeResolver.findActiveScriptInPluginSnapshot",
)(function* (
	snapshot: PluginRegistrySnapshot,
	input: { pluginSlug: string; scriptSlug: string; providerId?: string },
) {
	const plugin = snapshot.plugins[input.pluginSlug];
	const active = plugin?.scripts.find(({ slug }) => slug === input.scriptSlug);
	if (!plugin || !active) {
		return null;
	}
	const db = yield* Database;
	const [row] = yield* mapDatabaseErrors(
		db
			.select()
			.from(schema.sandboxScript)
			.where(
				and(
					eq(schema.sandboxScript.slug, active.slug),
					eq(schema.sandboxScript.pluginId, plugin.id),
					eq(schema.sandboxScript.contentHash, active.contentHash),
					input.providerId ? eq(schema.sandboxScript.providerId, input.providerId) : undefined,
				),
			)
			.limit(1),
	);
	return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
});

export const findActiveWorkflowScriptInSnapshot = (
	snapshot: PluginRegistrySnapshot,
	input: { pluginSlug: string; workflowSlug: string },
) => {
	const scriptSlug = snapshot.plugins[input.pluginSlug]?.manifest.workflows.find(
		({ slug }) => slug === input.workflowSlug,
	)?.scriptSlug;
	return scriptSlug
		? findActiveScriptInPluginSnapshot(snapshot, { pluginSlug: input.pluginSlug, scriptSlug })
		: Effect.succeed(null);
};

const findCompiledScriptRow = Effect.fn("PluginRuntimeResolver.findCompiledScriptRow")(
	function* (input: { pluginId: string; scriptSlug: string; contentHash: string }) {
		const db = yield* Database;
		const [row] = yield* mapDatabaseErrors(
			db
				.select()
				.from(schema.sandboxScript)
				.where(
					and(
						eq(schema.sandboxScript.slug, input.scriptSlug),
						eq(schema.sandboxScript.pluginId, input.pluginId),
						eq(schema.sandboxScript.contentHash, input.contentHash),
					),
				)
				.limit(1),
		);
		return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
	},
);

const findActivePluginRow = Effect.fn("PluginRuntimeResolver.findActivePluginRow")(function* (
	where: SQL | undefined,
) {
	const db = yield* Database;
	const [row] = yield* mapDatabaseErrors(
		db
			.select({
				id: schema.plugin.id,
				slug: schema.plugin.slug,
				scope: schema.plugin.scope,
				ownerId: schema.plugin.ownerId,
				manifest: schema.plugin.manifest,
				compiledHashes: schema.plugin.compiledHashes,
			})
			.from(schema.plugin)
			.where(and(eq(schema.plugin.status, "active"), where))
			.limit(1),
	);
	return row ?? null;
});

export class PluginRuntimeResolver extends Context.Service<PluginRuntimeResolver>()(
	"PluginRuntimeResolver",
	{
		make: Effect.gen(function* () {
			const loader = yield* PluginLoader;
			const installations = yield* PluginInstallationRepository;

			const getEffectiveDefinitions: (
				userId: UserId,
				includeUnavailable?: boolean,
			) => Effect.Effect<DefinitionSnapshot, DbError, Database> = Effect.fn(
				"PluginRuntimeResolver.getEffectiveDefinitions",
			)(function* (userId: UserId, includeUnavailable = false) {
				const states = yield* installations.listForUser(userId);
				const included = new Set(
					states
						.filter((state) =>
							includeUnavailable ? true : state.health === "ready" && !state.isDisabled,
						)
						.map(({ pluginId }) => pluginId),
				);
				const systemSource = definitionSourceFromSnapshot(loader.getSnapshot().definitions);
				const base = {
					savedViews: systemSource.savedViews.filter(
						(definition) => definition.pluginId == null || included.has(definition.pluginId),
					),
					entitySchemas: systemSource.entitySchemas.filter(
						(definition) => definition.pluginId == null || included.has(definition.pluginId),
					),
					signalSchemas: systemSource.signalSchemas.filter(
						(definition) => definition.pluginId == null || included.has(definition.pluginId),
					),
					relationshipSchemas: systemSource.relationshipSchemas.filter(
						(definition) => definition.pluginId == null || included.has(definition.pluginId),
					),
				};
				const db = yield* Database;
				const privatePlugins = (yield* mapDatabaseErrors(
					db
						.select({
							id: schema.plugin.id,
							slug: schema.plugin.slug,
							manifest: schema.plugin.manifest,
						})
						.from(schema.plugin)
						.where(
							and(
								eq(schema.plugin.scope, "user"),
								eq(schema.plugin.status, "active"),
								eq(schema.plugin.ownerId, userId),
							),
						),
				)).filter((plugin) => included.has(plugin.id));
				return buildDefinitionSnapshot(mergeManifestDefinitions(base, privatePlugins));
			});

			const availablePluginIdsForUser = Effect.fn(
				"PluginRuntimeResolver.availablePluginIdsForUser",
			)(function* (userId: UserId) {
				return new Set(
					(yield* installations.listForUser(userId))
						.filter((installation) => installation.health === "ready" && !installation.isDisabled)
						.map(({ pluginId }) => pluginId),
				);
			});

			const findActiveScript = Effect.fn("PluginRuntimeResolver.findActiveScript")(function* (
				scriptSlug: string,
			) {
				const snapshot = loader.getSnapshot();
				const active = activeScripts(snapshot).find(({ slug }) => slug === scriptSlug);
				if (!active) {
					return null;
				}
				return yield* findActiveScriptInPluginSnapshot(snapshot, {
					scriptSlug: active.slug,
					pluginSlug: active.pluginSlug,
				});
			});
			const findScriptAvailableToUser = Effect.fn(
				"PluginRuntimeResolver.findScriptAvailableToUser",
			)(function* (userId: UserId, pluginId: string, scriptSlug: string) {
				const snapshot = loader.getSnapshot();
				const systemPlugin = Object.values(snapshot.plugins).find(({ id }) => id === pluginId);
				if (systemPlugin) {
					const installation = yield* installations.findByUserAndPlugin(userId, systemPlugin.id);
					if (installation?.health === "ready" && !installation.isDisabled) {
						return yield* findActiveScriptInPluginSnapshot(snapshot, {
							scriptSlug,
							pluginSlug: systemPlugin.slug,
						});
					}
					return null;
				}

				const db = yield* Database;
				const plugins = yield* mapDatabaseErrors(
					db
						.select({
							id: schema.plugin.id,
							slug: schema.plugin.slug,
							manifest: schema.plugin.manifest,
							compiledHashes: schema.plugin.compiledHashes,
						})
						.from(schema.plugin)
						.where(
							and(
								eq(schema.plugin.id, pluginId),
								eq(schema.plugin.scope, "user"),
								eq(schema.plugin.status, "active"),
								eq(schema.plugin.ownerId, userId),
							),
						),
				);
				const plugin = plugins.find(({ manifest }) =>
					manifest.scripts.some(({ slug }) => slug === scriptSlug),
				);
				const contentHash = plugin?.compiledHashes[scriptSlug];
				if (!plugin || !contentHash) {
					return null;
				}
				const installation = yield* installations.findByUserAndPlugin(userId, plugin.id);
				if (installation?.health !== "ready" || installation.isDisabled) {
					return null;
				}
				return yield* findCompiledScriptRow({
					scriptSlug,
					contentHash,
					pluginId: plugin.id,
				});
			});
			const findActiveWorkflowScript = Effect.fn("PluginRuntimeResolver.findActiveWorkflowScript")(
				function* (input: { pluginSlug: string; workflowSlug: string }) {
					const snapshot = loader.getSnapshot();
					return yield* findActiveWorkflowScriptInSnapshot(snapshot, input);
				},
			);
			const resolveActivePluginBoot = Effect.fn("PluginRuntimeResolver.resolveActivePluginBoot")(
				function* (input: { pluginSlug: string; bootSlug: string }) {
					const snapshot = loader.getSnapshot();
					const boot = snapshot.plugins[input.pluginSlug]?.manifest.boot.find(
						({ slug }) => slug === input.bootSlug,
					);
					if (!boot) {
						return null;
					}
					const script = yield* findActiveScriptInPluginSnapshot(snapshot, {
						scriptSlug: boot.scriptSlug,
						pluginSlug: input.pluginSlug,
					});
					return script ? { boot, script } : null;
				},
			);
			const resolveActivePluginCron = Effect.fn("PluginRuntimeResolver.resolveActivePluginCron")(
				function* (input: { pluginSlug: string; cronSlug: string }) {
					const snapshot = loader.getSnapshot();
					const plugin = snapshot.plugins[input.pluginSlug];
					const cron = plugin?.manifest.crons.find(({ slug }) => slug === input.cronSlug);
					if (!plugin || !cron) {
						return null;
					}
					const script = yield* findActiveScriptInPluginSnapshot(snapshot, {
						scriptSlug: cron.scriptSlug,
						pluginSlug: input.pluginSlug,
					});
					return script ? { cron, script } : null;
				},
			);
			const resolveActivePluginUserBootstrap = Effect.fn(
				"PluginRuntimeResolver.resolveActivePluginUserBootstrap",
			)(function* (input: { pluginSlug: string; bootstrapSlug: string }) {
				const snapshot = loader.getSnapshot();
				const bootstrap = snapshot.plugins[input.pluginSlug]?.manifest.userBootstrap.find(
					({ slug }) => slug === input.bootstrapSlug,
				);
				if (!bootstrap) {
					return null;
				}
				const script = yield* findActiveScriptInPluginSnapshot(snapshot, {
					pluginSlug: input.pluginSlug,
					scriptSlug: bootstrap.scriptSlug,
				});
				return script ? { bootstrap, script } : null;
			});
			const findActiveOperation = Effect.fn("PluginRuntimeResolver.findActiveOperation")(
				(input: { pluginSlug: string; operationSlug: string }) =>
					Effect.sync(() => {
						const snapshot = loader.getSnapshot();
						const operation = snapshot.plugins[input.pluginSlug]?.manifest.operations.find(
							({ slug }) => slug === input.operationSlug,
						);
						return operation
							? {
									operation,
									script: findActiveScriptInPluginSnapshot(snapshot, {
										pluginSlug: input.pluginSlug,
										scriptSlug: operation.scriptSlug,
									}),
								}
							: null;
					}),
			);

			const findActiveScriptByIdInSnapshot = Effect.fn(
				"PluginRuntimeResolver.findActiveScriptByIdInSnapshot",
			)(function* (snapshot: PluginRegistrySnapshot, scriptId: SandboxScriptId) {
				const db = yield* Database;
				const [stored] = yield* mapDatabaseErrors(
					db
						.select({ slug: schema.sandboxScript.slug, pluginId: schema.sandboxScript.pluginId })
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				if (!stored?.pluginId) {
					return null;
				}
				const active = activeScripts(snapshot).find(
					(script) => script.pluginId === stored.pluginId && script.slug === stored.slug,
				);
				if (active) {
					const row = yield* findCompiledScriptRow({
						scriptSlug: active.slug,
						pluginId: active.pluginId,
						contentHash: active.contentHash,
					});
					return row ? { ...row, pluginSlug: active.pluginSlug } : null;
				}
				const plugin = yield* findActivePluginRow(eq(schema.plugin.id, stored.pluginId));
				if (plugin?.scope !== "user") {
					return null;
				}
				const contentHash = plugin.compiledHashes[stored.slug];
				if (!contentHash) {
					return null;
				}
				const row = yield* findCompiledScriptRow({
					contentHash,
					pluginId: plugin.id,
					scriptSlug: stored.slug,
				});
				return row ? { ...row, pluginSlug: plugin.slug } : null;
			});

			const findActiveScriptById = Effect.fn("PluginRuntimeResolver.findActiveScriptById")(
				function* (scriptId: SandboxScriptId) {
					return yield* findActiveScriptByIdInSnapshot(loader.getSnapshot(), scriptId);
				},
			);
			const resolveTrustedUserBootstrapCaller = Effect.fn(
				"PluginRuntimeResolver.resolveTrustedUserBootstrapCaller",
			)(function* (scriptId: SandboxScriptId) {
				const snapshot = loader.getSnapshot();
				const db = yield* Database;
				const [stored] = yield* mapDatabaseErrors(
					db
						.select({
							pluginId: schema.plugin.id,
							pluginSlug: schema.plugin.slug,
							slug: schema.sandboxScript.slug,
							pluginScope: schema.plugin.scope,
							contentHash: schema.sandboxScript.contentHash,
						})
						.from(schema.sandboxScript)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxScript.pluginId))
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				if (stored?.pluginScope !== "system") {
					return null;
				}
				const plugin = snapshot.plugins[stored.pluginSlug];
				if (plugin?.id !== stored.pluginId) {
					return null;
				}
				const active = plugin.scripts.find(
					(script) =>
						script.slug === stored.slug &&
						script.contentHash === stored.contentHash &&
						script.metadata.kind === "script",
				);
				if (
					!active ||
					!plugin.manifest.userBootstrap.some(({ scriptSlug }) => scriptSlug === stored.slug)
				) {
					return null;
				}
				return {
					pluginSlug: stored.pluginSlug,
					entitySchemaSlugs: plugin.manifest.entitySchemas.map(({ slug }) => slug),
				};
			});
			const resolvePluginConfigContext = Effect.fn(
				"PluginRuntimeResolver.resolvePluginConfigContext",
			)(function* (input: {
				readonly authority: ExecutionAuthority;
				readonly scriptId: SandboxScriptId;
			}) {
				const snapshot = loader.getSnapshot();
				const script = yield* findActiveScriptByIdInSnapshot(snapshot, input.scriptId);
				if (!script?.pluginSlug || !script.pluginId) {
					return null;
				}
				const systemPlugin = snapshot.plugins[script.pluginSlug];
				if (systemPlugin?.id === script.pluginId) {
					if (
						"userId" in input.authority &&
						!(yield* installations.findByUserAndPlugin(input.authority.userId, systemPlugin.id))
					) {
						return null;
					}
					return {
						kind: "environment",
						pluginSlug: script.pluginSlug,
						configSchema: systemPlugin.manifest.configSchema,
					} satisfies PluginConfigContext;
				}
				if (!("userId" in input.authority)) {
					return null;
				}
				const userId = input.authority.userId;
				const plugin = yield* findActivePluginRow(eq(schema.plugin.id, script.pluginId));
				if (plugin?.scope !== "user" || plugin.ownerId !== userId) {
					return null;
				}
				const installation = yield* installations.findByUserAndPlugin(userId, plugin.id);
				return installation
					? ({
							kind: "installation",
							config: installation.config,
							configSchema: plugin.manifest.configSchema,
						} satisfies PluginConfigContext)
					: null;
			});

			const isSystemPluginAvailableToUser = Effect.fn(
				"PluginRuntimeResolver.isSystemPluginAvailableToUser",
			)(function* (userId: UserId, pluginSlug: string) {
				const plugin = loader.getSnapshot().plugins[pluginSlug];
				if (!plugin) {
					return false;
				}
				const installation = yield* installations.findByUserAndPlugin(userId, plugin.id);
				return installation?.health === "ready" && !installation.isDisabled;
			});
			const isSystemProviderAvailableToUser = Effect.fn(
				"PluginRuntimeResolver.isSystemProviderAvailableToUser",
			)(function* (userId: UserId, providerId: SandboxProviderId) {
				const provider = yield* findActiveProviderByIdInSnapshot(loader.getSnapshot(), providerId);
				if (!provider) {
					return false;
				}
				const installation = yield* installations.findByUserAndPlugin(userId, provider.pluginId);
				return installation?.health === "ready" && !installation.isDisabled;
			});

			const findProviderAvailableToUserWhere = Effect.fn(
				"PluginRuntimeResolver.findProviderAvailableToUserWhere",
			)(function* (userId: UserId, where: SQL) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({ provider: schema.sandboxProvider, pluginScope: schema.plugin.scope })
						.from(schema.sandboxProvider)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
						.innerJoin(
							schema.pluginInstallation,
							and(
								eq(schema.pluginInstallation.pluginId, schema.plugin.id),
								eq(schema.pluginInstallation.userId, userId),
							),
						)
						.where(
							and(
								where,
								eq(schema.plugin.status, "active"),
								eq(schema.pluginInstallation.health, "ready"),
								eq(schema.pluginInstallation.isDisabled, false),
								or(isNull(schema.plugin.ownerId), eq(schema.plugin.ownerId, userId)),
							),
						)
						.limit(1),
				);
				if (!row) {
					return null;
				}
				const definitions = yield* getEffectiveDefinitions(userId);
				return definitions.entitySchemas[row.provider.rootEntitySchemaSlug]
					? {
							...row.provider,
							pluginScope: row.pluginScope,
							id: SandboxProviderId.make(row.provider.id),
						}
					: null;
			});
			const findProviderAvailableToUser = (userId: UserId, providerId: SandboxProviderId) =>
				findProviderAvailableToUserWhere(userId, eq(schema.sandboxProvider.id, providerId));
			const findProviderAvailableToUserBySlug = (userId: UserId, providerSlug: string) =>
				findProviderAvailableToUserWhere(userId, eq(schema.sandboxProvider.slug, providerSlug));

			const findUserOperation = Effect.fn("PluginRuntimeResolver.findUserOperation")(
				function* (input: {
					readonly userId: UserId;
					readonly pluginSlug: string;
					readonly operationSlug: string;
				}) {
					const plugin = yield* findActivePluginRow(
						and(
							eq(schema.plugin.scope, "user"),
							eq(schema.plugin.slug, input.pluginSlug),
							eq(schema.plugin.ownerId, input.userId),
						),
					);
					if (!plugin) {
						return null;
					}
					const installation = yield* installations.findByUserAndPlugin(input.userId, plugin.id);
					if (!installation || installation.isDisabled || installation.health !== "ready") {
						return null;
					}
					const operation = plugin.manifest.operations.find(
						({ slug }) => slug === input.operationSlug,
					);
					const contentHash = operation ? plugin.compiledHashes[operation.scriptSlug] : undefined;
					if (!operation || !contentHash) {
						return null;
					}
					const script = yield* findCompiledScriptRow({
						contentHash,
						pluginId: plugin.id,
						scriptSlug: operation.scriptSlug,
					});
					return script ? { operation, script } : null;
				},
			);
			const resolveSystemQueryScript = Effect.fn("PluginRuntimeResolver.resolveSystemQueryScript")(
				function* (scriptId: SandboxScriptId) {
					const snapshot = loader.getSnapshot();
					const db = yield* Database;
					const [script] = yield* mapDatabaseErrors(
						db
							.select()
							.from(schema.sandboxScript)
							.where(eq(schema.sandboxScript.id, scriptId))
							.limit(1),
					);
					if (!script?.pluginId || script.metadata.kind !== "script") {
						return null;
					}
					const plugin = findPluginEntryById(snapshot, script.pluginId);
					const active = plugin?.scripts.find(
						(candidate) =>
							candidate.slug === script.slug && candidate.contentHash === script.contentHash,
					);
					if (!plugin || active?.metadata.kind !== "script") {
						return null;
					}
					return {
						pluginSlug: plugin.slug,
						entitySchemaSlugs: plugin.manifest.entitySchemas.map(({ slug }) => slug),
						relationshipSchemaSlugs: plugin.manifest.relationshipSchemas.map(({ slug }) => slug),
						eventSchemas: plugin.manifest.entitySchemas.flatMap((entitySchema) =>
							entitySchema.eventSchemas.map((eventSchema) => ({
								eventSchemaSlug: eventSchema.slug,
								entitySchemaSlug: entitySchema.slug,
							})),
						),
					};
				},
			);

			const findKernelScript = Effect.fn("PluginRuntimeResolver.findKernelScript")(function* (
				scriptSlug: string,
			) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.sandboxScript)
						.where(
							and(
								eq(schema.sandboxScript.slug, scriptSlug),
								isNull(schema.sandboxScript.pluginId),
								isNotNull(schema.sandboxScript.contentHash),
							),
						)
						.orderBy(desc(schema.sandboxScript.updatedAt))
						.limit(1),
				);
				return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
			});

			const findActiveProviderInSnapshot = Effect.fn(
				"PluginRuntimeResolver.findActiveProviderInSnapshot",
			)(function* (snapshot: PluginRegistrySnapshot, providerSlug: string) {
				const active = Object.values(snapshot.plugins).find((plugin) =>
					plugin.manifest.providers.some(({ slug }) => slug === providerSlug),
				);
				if (!active) {
					return null;
				}
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.sandboxProvider)
						.where(
							and(
								eq(schema.sandboxProvider.slug, providerSlug),
								eq(schema.sandboxProvider.pluginId, active.id),
							),
						)
						.limit(1),
				);
				return row ? { ...row, id: SandboxProviderId.make(row.id) } : null;
			});

			const findActiveProviderByIdInSnapshot = Effect.fn(
				"PluginRuntimeResolver.findActiveProviderByIdInSnapshot",
			)(function* (snapshot: PluginRegistrySnapshot, providerId: SandboxProviderId) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.sandboxProvider)
						.where(eq(schema.sandboxProvider.id, providerId))
						.limit(1),
				);
				if (
					!row ||
					!findPluginEntryById(snapshot, row.pluginId)?.manifest.providers.some(
						({ slug }) => slug === row.slug,
					) ||
					!snapshot.definitions.entitySchemas[row.rootEntitySchemaSlug]
				) {
					return null;
				}
				return { ...row, id: SandboxProviderId.make(row.id) };
			});

			const findSchemaProviderBySlug = Effect.fn("PluginRuntimeResolver.findSchemaProviderBySlug")(
				function* (providerSlug: string) {
					const snapshot = loader.getSnapshot();
					const provider = yield* findActiveProviderInSnapshot(snapshot, providerSlug);
					return provider && snapshot.definitions.entitySchemas[provider.rootEntitySchemaSlug]
						? { provider, entitySchemaSlug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug) }
						: null;
				},
			);
			const findActiveProviderById = Effect.fn("PluginRuntimeResolver.findActiveProviderById")(
				function* (providerId: SandboxProviderId) {
					return yield* findActiveProviderByIdInSnapshot(loader.getSnapshot(), providerId);
				},
			);
			const findAuthorizedSchemaProviderById = Effect.fn(
				"PluginRuntimeResolver.findAuthorizedSchemaProviderById",
			)(function* (input: {
				pluginSlug: string;
				entitySchemaSlug: string;
				providerId: SandboxProviderId;
			}) {
				const snapshot = loader.getSnapshot();
				const manifest = snapshot.plugins[input.pluginSlug]?.manifest;
				const provider = yield* findActiveProviderByIdInSnapshot(snapshot, input.providerId);
				if (
					!manifest?.entitySchemas.some(({ slug }) => slug === input.entitySchemaSlug) ||
					!provider ||
					provider.rootEntitySchemaSlug !== input.entitySchemaSlug
				) {
					return null;
				}
				return { provider, entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug) };
			});

			const listSchemaProviders = Effect.fn("PluginRuntimeResolver.listSchemaProviders")(function* (
				entitySchemaSlugs?: ReadonlyArray<string>,
				userId?: UserId,
			) {
				const snapshot = loader.getSnapshot();
				const db = yield* Database;
				const activePluginIds = Object.values(snapshot.plugins).map(({ id }) => id);
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.sandboxProvider)
						.where(
							activePluginIds.length > 0
								? inArray(schema.sandboxProvider.pluginId, activePluginIds)
								: sql`false`,
						),
				);
				const availablePluginIds = userId ? yield* availablePluginIdsForUser(userId) : null;
				return rows
					.filter((provider) => {
						const plugin = findPluginEntryById(snapshot, provider.pluginId);
						return (
							(availablePluginIds === null || availablePluginIds.has(provider.pluginId)) &&
							plugin?.manifest.providers.some(({ slug }) => slug === provider.slug) === true &&
							snapshot.definitions.entitySchemas[provider.rootEntitySchemaSlug] !== undefined &&
							(entitySchemaSlugs === undefined ||
								entitySchemaSlugs.includes(provider.rootEntitySchemaSlug))
						);
					})
					.map((provider) => ({
						provider: { ...provider, id: SandboxProviderId.make(provider.id) },
						entitySchemaSlug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug),
					}))
					.sort(
						(left, right) =>
							left.entitySchemaSlug.localeCompare(right.entitySchemaSlug) ||
							left.provider.slug.localeCompare(right.provider.slug),
					);
			});

			const findProviderOperationScriptInSnapshot = Effect.fn(
				"PluginRuntimeResolver.findProviderOperationScriptInSnapshot",
			)(function* (
				snapshot: PluginRegistrySnapshot,
				providerId: SandboxProviderId,
				operation: PluginProviderOperation,
			) {
				const provider = yield* findActiveProviderByIdInSnapshot(snapshot, providerId);
				if (!provider) {
					return { provider: null, script: null, reason: "inactive_provider" as const };
				}
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({
							script: schema.sandboxScript,
							optionsSchema: schema.sandboxProviderOperation.optionsSchema,
						})
						.from(schema.sandboxProviderOperation)
						.innerJoin(
							schema.sandboxProvider,
							eq(schema.sandboxProviderOperation.providerId, schema.sandboxProvider.id),
						)
						.leftJoin(
							schema.sandboxScript,
							eq(schema.sandboxProviderOperation.scriptId, schema.sandboxScript.id),
						)
						.where(
							and(
								eq(schema.sandboxProviderOperation.providerId, provider.id),
								eq(schema.sandboxProviderOperation.operation, operation),
							),
						)
						.limit(1),
				);
				if (!row) {
					return { provider, script: null, reason: "unsupported_operation" as const };
				}
				if (
					!row.script ||
					row.script.providerId !== provider.id ||
					row.script.pluginId !== provider.pluginId ||
					row.script.metadata.kind !== "provider"
				) {
					return { provider, script: null, reason: "script_unavailable" as const };
				}
				return {
					provider,
					reason: null,
					script: {
						...row.script,
						id: SandboxScriptId.make(row.script.id),
						...(row.optionsSchema ? { optionsSchema: row.optionsSchema } : {}),
					},
				};
			});

			const resolveOperation =
				(operation: PluginProviderOperation) => (providerId: SandboxProviderId) =>
					Effect.suspend(() => {
						const snapshot = loader.getSnapshot();
						return findProviderOperationScriptInSnapshot(snapshot, providerId, operation);
					}).pipe(
						Effect.flatMap(({ provider, reason, script }) =>
							script
								? Effect.succeed(script)
								: Effect.fail(
										new UnsupportedProviderOperationError({
											reason,
											operation,
											providerId,
											providerSlug: provider?.slug ?? null,
										}),
									),
						),
					);

			const resolveUserProviderOperation =
				(operation: PluginProviderOperation) => (userId: UserId, providerId: SandboxProviderId) =>
					Effect.gen(function* () {
						const provider = yield* findProviderAvailableToUser(userId, providerId);
						if (!provider) {
							return yield* new UnsupportedProviderOperationError({
								operation,
								providerId,
								providerSlug: null,
								reason: "inactive_provider",
							});
						}
						const db = yield* Database;
						const [row] = yield* mapDatabaseErrors(
							db
								.select({
									script: schema.sandboxScript,
									compiledHashes: schema.plugin.compiledHashes,
									optionsSchema: schema.sandboxProviderOperation.optionsSchema,
								})
								.from(schema.sandboxProviderOperation)
								.innerJoin(
									schema.sandboxScript,
									eq(schema.sandboxProviderOperation.scriptId, schema.sandboxScript.id),
								)
								.innerJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxScript.pluginId))
								.where(
									and(
										eq(schema.sandboxProviderOperation.providerId, providerId),
										eq(schema.sandboxProviderOperation.operation, operation),
									),
								)
								.limit(1),
						);
						if (!row) {
							return yield* new UnsupportedProviderOperationError({
								operation,
								providerId,
								providerSlug: provider.slug,
								reason: "unsupported_operation",
							});
						}
						if (
							row.script.providerId !== providerId ||
							row.script.pluginId !== provider.pluginId ||
							row.script.metadata.kind !== "provider" ||
							row.compiledHashes[row.script.slug] !== row.script.contentHash
						) {
							return yield* new UnsupportedProviderOperationError({
								operation,
								providerId,
								providerSlug: provider.slug,
								reason: "script_unavailable",
							});
						}
						return {
							...row.script,
							id: SandboxScriptId.make(row.script.id),
							...(row.optionsSchema ? { optionsSchema: row.optionsSchema } : {}),
						};
					});
			const findDetailsScript = (providerId: SandboxProviderId) => {
				const findOperation = Effect.suspend(() =>
					findProviderOperationScriptInSnapshot(loader.getSnapshot(), providerId, "details"),
				).pipe(Effect.map(({ script }) => script));
				return findOperation;
			};
			const resolveSearchScript = (providerId: SandboxProviderId) =>
				resolveOperation("search")(providerId).pipe(
					Effect.map((script) => ({ ...script, optionsSchema: script.optionsSchema ?? null })),
				);
			const resolveSearchOptionsScript = resolveOperation("search-options");
			const resolveDetailsScript = resolveOperation("details");
			const resolveResolveScript = resolveOperation("resolve");
			const resolveTranslateScript = resolveOperation("translate");
			const resolveUserSearchScript = (userId: UserId, providerId: SandboxProviderId) =>
				resolveUserProviderOperation("search")(userId, providerId).pipe(
					Effect.map((script) => ({ ...script, optionsSchema: script.optionsSchema ?? null })),
				);
			const resolveUserDetailsScript = resolveUserProviderOperation("details");
			const resolveUserTranslateScript = resolveUserProviderOperation("translate");
			const resolveUserSearchOptionsScript = resolveUserProviderOperation("search-options");

			const automationBindings = (
				snapshot: PluginRegistrySnapshot,
			): ReadonlyArray<BindingAutomation> => {
				const bindings: BindingAutomation[] = [];
				for (const [pluginSlug, plugin] of Object.entries(snapshot.plugins)) {
					const nameBySlug = new Map(
						plugin.manifest.scripts.map((script) => [script.slug, script.name]),
					);
					const name = (scriptSlug: string) => nameBySlug.get(scriptSlug) ?? scriptSlug;
					for (const binding of plugin.manifest.bindings.entityAutomations) {
						bindings.push({
							pluginSlug,
							position: null,
							metadata: null,
							kind: "subscription",
							operation: binding.operation,
							name: name(binding.scriptSlug),
							scriptSlug: binding.scriptSlug,
							target: {
								kind: "entity_schema",
								id: EntitySchemaSlug.make(binding.entitySchemaSlug),
							},
						});
					}
					for (const binding of plugin.manifest.bindings.relationshipAutomations) {
						bindings.push({
							pluginSlug,
							position: null,
							metadata: null,
							kind: "subscription",
							name: name(binding.scriptSlug),
							operation: binding.operation,
							scriptSlug: binding.scriptSlug,
							target: {
								kind: "relationship_schema",
								id: RelationshipSchemaSlug.make(binding.relationshipSchemaSlug),
							},
						});
					}
					for (const binding of plugin.manifest.bindings.eventAutomations) {
						bindings.push({
							pluginSlug,
							kind: binding.kind,
							operation: "create",
							name: name(binding.scriptSlug),
							scriptSlug: binding.scriptSlug,
							position: binding.kind === "policy" ? (binding.position ?? 1000) : null,
							target: { kind: "event_schema", id: EventSchemaSlug.make(binding.eventSchemaSlug) },
							metadata: binding.metadata
								? {
										...(binding.metadata.origins ? { origins: [...binding.metadata.origins] } : {}),
										...(binding.metadata.batchMode
											? { batchMode: binding.metadata.batchMode }
											: {}),
										...(binding.metadata.inheritedProperties
											? { inheritedProperties: [...binding.metadata.inheritedProperties] }
											: {}),
									}
								: null,
						});
					}
					for (const binding of plugin.manifest.bindings.signalAutomations) {
						bindings.push({
							pluginSlug,
							position: null,
							metadata: null,
							operation: "signal",
							kind: "subscription",
							name: name(binding.scriptSlug),
							scriptSlug: binding.scriptSlug,
							target: {
								kind: "signal_schema",
								id: SignalSchemaSlug.make(binding.signalSchemaSlug),
							},
						});
					}
				}
				return bindings;
			};

			const resolveAutomation = Effect.fn("PluginRuntimeResolver.resolveAutomation")(function* (
				snapshot: PluginRegistrySnapshot,
				binding: BindingAutomation,
			) {
				const active = activeScripts(snapshot).find(({ slug }) => slug === binding.scriptSlug);
				const script = active
					? yield* findActiveScriptInPluginSnapshot(snapshot, {
							scriptSlug: active.slug,
							pluginSlug: active.pluginSlug,
						})
					: null;
				if (!script) {
					return null;
				}
				const resolved: ResolvedAutomationRule = {
					userId: null,
					isActive: true,
					isBuiltin: true,
					name: binding.name,
					kind: binding.kind,
					id: bindingId(binding),
					target: binding.target,
					metadata: binding.metadata,
					position: binding.position,
					sandboxScriptId: script.id,
					operation: binding.operation,
				};
				return resolved;
			});

			const listAutomations = Effect.fn("PluginRuntimeResolver.listAutomations")(function* (input: {
				userId: UserId | null;
				kind: AutomationRuleKind;
				target: AutomationRuleTarget;
				operation: AutomationOperation;
			}) {
				const snapshot = loader.getSnapshot();
				const availablePluginIds = input.userId
					? yield* availablePluginIdsForUser(input.userId)
					: null;
				const bindings = automationBindings(snapshot).filter(
					(binding) =>
						(availablePluginIds === null ||
							availablePluginIds.has(snapshot.plugins[binding.pluginSlug]?.id ?? "")) &&
						binding.kind === input.kind &&
						binding.operation === input.operation &&
						binding.target.kind === input.target.kind &&
						binding.target.id === input.target.id,
				);
				const forEachBindings = Effect.forEach(bindings, (binding) =>
					resolveAutomation(snapshot, binding),
				).pipe(Effect.map((resolved) => resolved.filter((value) => value !== null)));
				return yield* forEachBindings;
			});

			const listProviderEntityImportAutomations = Effect.fn(
				"PluginRuntimeResolver.listProviderEntityImportAutomations",
			)(function* (entitySchemaSlug: EntitySchemaSlug) {
				const snapshot = loader.getSnapshot();
				const resolved: ResolvedProviderEntityImportAutomation[] = [];
				for (const [pluginSlug, plugin] of Object.entries(snapshot.plugins)) {
					for (const [
						index,
						binding,
					] of plugin.manifest.bindings.providerEntityImportAutomations.entries()) {
						if (binding.entitySchemaSlug !== entitySchemaSlug) {
							continue;
						}
						const declared = plugin.scripts.find(({ slug }) => slug === binding.scriptSlug);
						if (!declared) {
							return yield* new InvalidProviderEntityImportAutomationError({
								pluginSlug,
								reason: "missing_script",
								scriptSlug: binding.scriptSlug,
							});
						}
						if (declared.metadata.kind !== "automation") {
							return yield* new InvalidProviderEntityImportAutomationError({
								pluginSlug,
								reason: "wrong_script_kind",
								scriptSlug: binding.scriptSlug,
							});
						}
						const script = yield* findActiveScriptInPluginSnapshot(snapshot, {
							pluginSlug,
							scriptSlug: binding.scriptSlug,
						});
						if (!script) {
							return yield* new InvalidProviderEntityImportAutomationError({
								pluginSlug,
								reason: "inactive_script",
								scriptSlug: binding.scriptSlug,
							});
						}
						resolved.push({
							sandboxScriptId: script.id,
							ruleId: providerEntityImportBindingId({
								index,
								pluginSlug,
								entitySchemaSlug,
								scriptSlug: binding.scriptSlug,
							}),
						});
					}
				}
				return resolved;
			});

			const findAutomation = Effect.fn("PluginRuntimeResolver.findAutomation")(function* (
				id: AutomationRuleId,
			) {
				const snapshot = loader.getSnapshot();
				const binding = automationBindings(snapshot).find(
					(candidate) => bindingId(candidate) === id,
				);
				return binding ? yield* resolveAutomation(snapshot, binding) : null;
			});

			return {
				findAutomation,
				listAutomations,
				findKernelScript,
				findActiveScript,
				findUserOperation,
				findDetailsScript,
				findActiveOperation,
				listSchemaProviders,
				resolveSearchScript,
				findActiveScriptById,
				resolveDetailsScript,
				resolveResolveScript,
				findActiveProviderById,
				resolveTranslateScript,
				resolveUserSearchScript,
				getEffectiveDefinitions,
				resolveActivePluginBoot,
				resolveActivePluginCron,
				findSchemaProviderBySlug,
				resolveUserDetailsScript,
				findActiveWorkflowScript,
				resolveSystemQueryScript,
				findScriptAvailableToUser,
				resolvePluginConfigContext,
				resolveUserTranslateScript,
				resolveSearchOptionsScript,
				findProviderAvailableToUser,
				isSystemPluginAvailableToUser,
				resolveUserSearchOptionsScript,
				isSystemProviderAvailableToUser,
				findAuthorizedSchemaProviderById,
				resolveActivePluginUserBootstrap,
				findProviderAvailableToUserBySlug,
				resolveTrustedUserBootstrapCaller,
				listProviderEntityImportAutomations,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginRuntimeResolverLive = PluginRuntimeResolver.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(PluginLoaderLive, PluginInstallationRepository.layer)),
);
