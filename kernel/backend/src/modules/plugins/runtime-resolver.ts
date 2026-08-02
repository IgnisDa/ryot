import type { DbError } from "@ryot/contract/errors";
import type {
	AutomationOperation,
	AutomationRuleKind,
	AutomationRuleMetadata,
} from "@ryot/contract/modules/automations/schemas";
import type {
	PluginManifest,
	PluginProviderOperation,
} from "@ryot/contract/modules/plugins/manifest";
import {
	AutomationRuleId,
	EntitySchemaSlug,
	EventSchemaSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SandboxScriptId,
	SignalSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import { and, desc, eq, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import type { PluginConfigContext } from "#lib/infrastructure/sandbox-runtime/app-config";
import type { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
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
	type PluginRegistryEntry,
	type PluginRegistrySnapshot,
} from "./loader";

const collectSurvivingSlugs = (
	baseSlugs: ReadonlySet<string>,
	plugins: ReadonlyArray<{ readonly manifest: PluginManifest }>,
	select: (manifest: PluginManifest) => ReadonlyArray<{ readonly slug: string }>,
) =>
	new Set([
		...baseSlugs,
		...plugins.flatMap(({ manifest }) => select(manifest).map(({ slug }) => slug)),
	]);

export type AutomationRuleTarget =
	| { kind: "event_schema"; id: EventSchemaSlug }
	| { kind: "entity_schema"; id: EntitySchemaSlug }
	| { kind: "signal_schema"; id: SignalSchemaSlug }
	| { kind: "relationship_schema"; id: RelationshipSchemaSlug };

type BindingAutomation = {
	name: string;
	pluginId: string;
	pluginSlug: string;
	scriptSlug: string;
	contentHash: string;
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

export type AvailablePlugin = {
	readonly id: string;
	readonly slug: string;
	readonly sourceHash: string;
	readonly installationId: string;
	readonly scope: "system" | "user";
	readonly manifest: PluginManifest;
	readonly compiledHashes: Record<string, string>;
	readonly config: Readonly<Record<string, unknown>>;
};

type BindingPlugin = Pick<AvailablePlugin, "id" | "slug" | "manifest" | "compiledHashes">;

const bindingPluginFromEntry = (plugin: PluginRegistryEntry): BindingPlugin => ({
	id: plugin.id,
	slug: plugin.slug,
	manifest: plugin.manifest,
	compiledHashes: Object.fromEntries(
		plugin.scripts.map((script) => [script.slug, script.contentHash]),
	),
});

export const pluginConfigContextFor = (plugin: AvailablePlugin): PluginConfigContext =>
	plugin.scope === "system"
		? {
				kind: "environment",
				pluginSlug: plugin.slug,
				configSchema: plugin.manifest.configSchema,
			}
		: {
				kind: "installation",
				config: plugin.config,
				configSchema: plugin.manifest.configSchema,
			};

export type ResolvedProviderEntityImportAutomation = {
	readonly ruleId: AutomationRuleId;
	readonly sandboxScriptId: SandboxScriptId;
};

const bindingId = (binding: BindingAutomation) =>
	AutomationRuleId.make(
		[
			"binding",
			binding.pluginId,
			binding.kind,
			binding.target.kind,
			binding.target.id,
			binding.operation,
			binding.scriptSlug,
		].join(":"),
	);

const providerEntityImportBindingId = (input: {
	index: number;
	pluginId: string;
	scriptSlug: string;
	entitySchemaSlug: string;
}) =>
	AutomationRuleId.make(
		[
			"binding",
			input.pluginId,
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

const privateCronInstallation = {
	pluginId: schema.plugin.id,
	pluginSlug: schema.plugin.slug,
	manifest: schema.plugin.manifest,
	userId: schema.pluginInstallation.userId,
	installationId: schema.pluginInstallation.id,
	compiledHashes: schema.plugin.compiledHashes,
};

const activePrivateInstallation = (where?: SQL) =>
	and(
		where,
		eq(schema.plugin.scope, "user"),
		eq(schema.plugin.status, "active"),
		eq(schema.pluginInstallation.health, "ready"),
		eq(schema.pluginInstallation.isDisabled, false),
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
							includeUnavailable
								? // An incompatible installation conflicts with the authoritative shipped set, so
									// its definitions must never participate in a composed view; its persisted rows
									// stay attributable through their own qualified plugin id.
									state.health !== "incompatible"
								: // A private installation runs its user-bootstrap entries while it is still
									// installing, and those scripts must be able to read their own schemas.
									(state.health === "ready" || state.health === "installing") && !state.isDisabled,
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
				const baseSlugs = {
					savedViews: new Set(base.savedViews.map(({ slug }) => slug)),
					entitySchemas: new Set(base.entitySchemas.map(({ slug }) => slug)),
					signalSchemas: new Set(base.signalSchemas.map(({ slug }) => slug)),
					relationshipSchemas: new Set(base.relationshipSchemas.map(({ slug }) => slug)),
				};
				const withEntitySchemas = privatePlugins.map((plugin) =>
					Object.assign(plugin, {
						manifest: {
							...plugin.manifest,
							entitySchemas: plugin.manifest.entitySchemas.filter(
								({ slug }) => !baseSlugs.entitySchemas.has(slug),
							),
						},
					}),
				);
				const entitySchemaSlugs = collectSurvivingSlugs(
					baseSlugs.entitySchemas,
					withEntitySchemas,
					({ entitySchemas }) => entitySchemas,
				);
				const withRelationshipSchemas = withEntitySchemas.map((plugin) =>
					Object.assign(plugin, {
						manifest: {
							...plugin.manifest,
							relationshipSchemas: plugin.manifest.relationshipSchemas.filter(
								(definition) =>
									!baseSlugs.relationshipSchemas.has(definition.slug) &&
									[definition.sourceEntitySchemaSlug, definition.targetEntitySchemaSlug].every(
										(slug) => slug === null || entitySchemaSlugs.has(slug),
									),
							),
						},
					}),
				);
				const relationshipSchemaSlugs = collectSurvivingSlugs(
					baseSlugs.relationshipSchemas,
					withRelationshipSchemas,
					({ relationshipSchemas }) => relationshipSchemas,
				);
				const composable = withRelationshipSchemas.map((plugin) =>
					Object.assign(plugin, {
						manifest: {
							...plugin.manifest,
							savedViews: plugin.manifest.savedViews.filter(
								({ slug, entitySchemaSlug }) =>
									!baseSlugs.savedViews.has(slug) &&
									(entitySchemaSlug === null || entitySchemaSlugs.has(entitySchemaSlug)),
							),
							signalSchemas: plugin.manifest.signalSchemas.filter(
								({ slug, audiencePolicy }) =>
									!baseSlugs.signalSchemas.has(slug) &&
									(audiencePolicy.kind !== "related_users" ||
										relationshipSchemaSlugs.has(audiencePolicy.relationshipSchemaSlug)),
							),
						},
					}),
				);
				return buildDefinitionSnapshot(mergeManifestDefinitions(base, composable));
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

			const listPluginsAvailableToUser: (
				userId: UserId,
			) => Effect.Effect<ReadonlyArray<AvailablePlugin>, DbError, Database> = Effect.fn(
				"PluginRuntimeResolver.listPluginsAvailableToUser",
			)(function* (userId: UserId) {
				const states = (yield* installations.listForUser(userId)).filter(
					(state) => state.health === "ready" && !state.isDisabled,
				);
				const stateByPluginId = new Map(states.map((state) => [state.pluginId, state]));
				const available: Array<AvailablePlugin> = [];
				for (const plugin of Object.values(loader.getSnapshot().plugins)) {
					const state = stateByPluginId.get(plugin.id);
					if (!state) {
						continue;
					}
					available.push({
						config: {},
						scope: "system",
						installationId: state.id,
						sourceHash: plugin.sourceHash,
						...bindingPluginFromEntry(plugin),
					});
				}
				const db = yield* Database;
				const owned = yield* mapDatabaseErrors(
					db
						.select({
							id: schema.plugin.id,
							slug: schema.plugin.slug,
							manifest: schema.plugin.manifest,
							sourceHash: schema.plugin.sourceHash,
							compiledHashes: schema.plugin.compiledHashes,
						})
						.from(schema.plugin)
						.where(
							and(
								eq(schema.plugin.scope, "user"),
								eq(schema.plugin.status, "active"),
								eq(schema.plugin.ownerId, userId),
							),
						),
				);
				for (const plugin of owned) {
					const state = stateByPluginId.get(plugin.id);
					if (!state) {
						continue;
					}
					available.push({
						...plugin,
						scope: "user",
						config: state.config,
						installationId: state.id,
					});
				}
				return available.sort((left, right) => left.slug.localeCompare(right.slug));
			});

			const findPluginAvailableToUser = Effect.fn(
				"PluginRuntimeResolver.findPluginAvailableToUser",
			)(function* (userId: UserId, pluginId: string) {
				const available = yield* listPluginsAvailableToUser(userId);
				return available.find(({ id }) => id === pluginId) ?? null;
			});

			const findScriptInAvailablePlugin = Effect.fn(
				"PluginRuntimeResolver.findScriptInAvailablePlugin",
			)(function* (plugin: AvailablePlugin, scriptSlug: string) {
				const contentHash = plugin.compiledHashes[scriptSlug];
				return contentHash
					? yield* findCompiledScriptRow({ scriptSlug, contentHash, pluginId: plugin.id })
					: null;
			});

			const findWorkflowScriptInAvailablePlugin = Effect.fn(
				"PluginRuntimeResolver.findWorkflowScriptInAvailablePlugin",
			)(function* (plugin: AvailablePlugin, workflowSlug: string) {
				const scriptSlug = plugin.manifest.workflows.find(
					({ slug }) => slug === workflowSlug,
				)?.scriptSlug;
				return scriptSlug ? yield* findScriptInAvailablePlugin(plugin, scriptSlug) : null;
			});

			const findWorkflowScriptAvailableToUser = Effect.fn(
				"PluginRuntimeResolver.findWorkflowScriptAvailableToUser",
			)(function* (
				userId: UserId,
				pluginId: string,
				workflowSlug: string,
				pluginInstallationId: string,
			) {
				const plugin = yield* findPluginAvailableToUser(userId, pluginId);
				return plugin?.installationId === pluginInstallationId
					? yield* findWorkflowScriptInAvailablePlugin(plugin, workflowSlug)
					: null;
			});

			const findOperationAvailableToUser = Effect.fn(
				"PluginRuntimeResolver.findOperationAvailableToUser",
			)(function* (input: {
				readonly userId: UserId;
				readonly pluginSlug: string;
				readonly operationSlug: string;
			}) {
				const available = yield* listPluginsAvailableToUser(input.userId);
				const plugin =
					available.find(
						(candidate) => candidate.scope === "system" && candidate.slug === input.pluginSlug,
					) ?? available.find((candidate) => candidate.slug === input.pluginSlug);
				const operation = plugin?.manifest.operations.find(
					({ slug }) => slug === input.operationSlug,
				);
				const contentHash =
					operation && plugin ? plugin.compiledHashes[operation.scriptSlug] : undefined;
				if (!plugin || !operation || !contentHash) {
					return null;
				}
				const script = yield* findCompiledScriptRow({
					contentHash,
					pluginId: plugin.id,
					scriptSlug: operation.scriptSlug,
				});
				return script ? { plugin, operation, script } : null;
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
			const listPrivateCronSchedules = Effect.fn("PluginRuntimeResolver.listPrivateCronSchedules")(
				function* () {
					const db = yield* Database;
					const rows = yield* mapDatabaseErrors(
						db
							.select(privateCronInstallation)
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.where(activePrivateInstallation()),
					);
					return rows
						.flatMap((row) =>
							row.manifest.crons.map((cron) => ({
								cron,
								pluginId: row.pluginId,
								pluginSlug: row.pluginSlug,
								installationId: row.installationId,
								userId: UserId.make(row.userId),
							})),
						)
						.sort(
							(left, right) =>
								left.pluginSlug.localeCompare(right.pluginSlug) ||
								left.cron.slug.localeCompare(right.cron.slug) ||
								left.installationId.localeCompare(right.installationId),
						);
				},
			);

			const resolvePrivatePluginCron = Effect.fn("PluginRuntimeResolver.resolvePrivatePluginCron")(
				function* (input: { installationId: string; cronSlug: string }) {
					const db = yield* Database;
					const [row] = yield* mapDatabaseErrors(
						db
							.select(privateCronInstallation)
							.from(schema.pluginInstallation)
							.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
							.where(
								activePrivateInstallation(eq(schema.pluginInstallation.id, input.installationId)),
							)
							.limit(1),
					);
					const cron = row?.manifest.crons.find(({ slug }) => slug === input.cronSlug);
					const contentHash = cron ? row?.compiledHashes[cron.scriptSlug] : undefined;
					if (!row || !cron || !contentHash) {
						return null;
					}
					const script = yield* findCompiledScriptRow({
						contentHash,
						pluginId: row.pluginId,
						scriptSlug: cron.scriptSlug,
					});
					return script
						? { cron, script, pluginSlug: row.pluginSlug, userId: UserId.make(row.userId) }
						: null;
				},
			);

			const resolveInstallationBootstrap = Effect.fn(
				"PluginRuntimeResolver.resolveInstallationBootstrap",
			)(function* (installationId: string) {
				const db = yield* Database;
				const [row] = yield* mapDatabaseErrors(
					db
						.select({
							pluginId: schema.plugin.id,
							pluginScope: schema.plugin.scope,
							manifest: schema.plugin.manifest,
							userId: schema.pluginInstallation.userId,
							health: schema.pluginInstallation.health,
							compiledHashes: schema.plugin.compiledHashes,
						})
						.from(schema.pluginInstallation)
						.innerJoin(schema.plugin, eq(schema.plugin.id, schema.pluginInstallation.pluginId))
						.where(
							and(
								eq(schema.plugin.status, "active"),
								eq(schema.pluginInstallation.id, installationId),
							),
						)
						.limit(1),
				);
				if (!row) {
					return null;
				}
				const entries = yield* Effect.forEach(row.manifest.userBootstrap, (entry) =>
					Effect.gen(function* () {
						const contentHash = row.compiledHashes[entry.scriptSlug];
						const script = contentHash
							? yield* findCompiledScriptRow({
									contentHash,
									pluginId: row.pluginId,
									scriptSlug: entry.scriptSlug,
								})
							: null;
						return { slug: entry.slug, scriptId: script?.id ?? null };
					}),
				);
				return {
					entries,
					health: row.health,
					pluginScope: row.pluginScope,
					userId: UserId.make(row.userId),
				};
			});

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
			const resolvePluginConfigContext = Effect.fn(
				"PluginRuntimeResolver.resolvePluginConfigContext",
			)(function* (principal: SandboxExecutionPrincipal) {
				const revision = principal.pluginRevision;
				if (!revision) {
					return null;
				}
				if (revision.scope === "system") {
					if (
						"userId" in principal.subject &&
						!(yield* installations.findByUserAndPlugin(principal.subject.userId, revision.id))
					) {
						return null;
					}
					return {
						kind: "environment",
						pluginSlug: revision.slug,
						configSchema: revision.configSchema,
					} satisfies PluginConfigContext;
				}
				if (!("userId" in principal.subject)) {
					return null;
				}
				const userId = principal.subject.userId;
				if (revision.ownerId !== userId) {
					return null;
				}
				const installation = yield* installations.findByUserAndPlugin(userId, revision.id);
				return installation
					? ({
							kind: "installation",
							config: installation.config,
							configSchema: revision.configSchema,
						} satisfies PluginConfigContext)
					: null;
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
				plugins: ReadonlyArray<BindingPlugin>,
			): ReadonlyArray<BindingAutomation> => {
				const bindings: BindingAutomation[] = [];
				for (const plugin of plugins) {
					const nameBySlug = new Map(
						plugin.manifest.scripts.map((script) => [script.slug, script.name]),
					);
					const name = (scriptSlug: string) => nameBySlug.get(scriptSlug) ?? scriptSlug;
					const add = (
						binding: Omit<BindingAutomation, "pluginId" | "pluginSlug" | "contentHash">,
					) => {
						const contentHash = plugin.compiledHashes[binding.scriptSlug];
						if (contentHash) {
							bindings.push({
								...binding,
								contentHash,
								pluginId: plugin.id,
								pluginSlug: plugin.slug,
							});
						}
					};
					for (const binding of plugin.manifest.bindings.entityAutomations) {
						add({
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
						add({
							position: null,
							metadata: null,
							kind: "subscription",
							operation: binding.operation,
							name: name(binding.scriptSlug),
							scriptSlug: binding.scriptSlug,
							target: {
								kind: "relationship_schema",
								id: RelationshipSchemaSlug.make(binding.relationshipSchemaSlug),
							},
						});
					}
					for (const binding of plugin.manifest.bindings.eventAutomations) {
						add({
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
						add({
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

			const bindingPlugins = Effect.fn("PluginRuntimeResolver.bindingPlugins")(function* (
				userId: UserId | null,
			) {
				return userId === null
					? Object.values(loader.getSnapshot().plugins).map(bindingPluginFromEntry)
					: yield* listPluginsAvailableToUser(userId);
			});

			const resolveAutomation = Effect.fn("PluginRuntimeResolver.resolveAutomation")(function* (
				binding: BindingAutomation,
			) {
				const script = yield* findCompiledScriptRow({
					pluginId: binding.pluginId,
					scriptSlug: binding.scriptSlug,
					contentHash: binding.contentHash,
				});
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
				const bindings = automationBindings(yield* bindingPlugins(input.userId)).filter(
					(binding) =>
						binding.kind === input.kind &&
						binding.operation === input.operation &&
						binding.target.kind === input.target.kind &&
						binding.target.id === input.target.id,
				);
				const resolved = yield* Effect.forEach(bindings, resolveAutomation);
				return resolved.filter((value) => value !== null);
			});

			const listProviderEntityImportAutomations = Effect.fn(
				"PluginRuntimeResolver.listProviderEntityImportAutomations",
			)(function* (userId: UserId | null, entitySchemaSlug: EntitySchemaSlug) {
				const resolved: ResolvedProviderEntityImportAutomation[] = [];
				for (const plugin of yield* bindingPlugins(userId)) {
					for (const [
						index,
						binding,
					] of plugin.manifest.bindings.providerEntityImportAutomations.entries()) {
						if (binding.entitySchemaSlug !== entitySchemaSlug) {
							continue;
						}
						const declared = plugin.manifest.scripts.find(
							({ slug }) => slug === binding.scriptSlug,
						);
						if (!declared) {
							return yield* new InvalidProviderEntityImportAutomationError({
								reason: "missing_script",
								pluginSlug: plugin.slug,
								scriptSlug: binding.scriptSlug,
							});
						}
						if (declared.kind !== "automation") {
							return yield* new InvalidProviderEntityImportAutomationError({
								pluginSlug: plugin.slug,
								reason: "wrong_script_kind",
								scriptSlug: binding.scriptSlug,
							});
						}
						const contentHash = plugin.compiledHashes[binding.scriptSlug];
						const script = contentHash
							? yield* findCompiledScriptRow({
									contentHash,
									pluginId: plugin.id,
									scriptSlug: binding.scriptSlug,
								})
							: null;
						if (!script) {
							return yield* new InvalidProviderEntityImportAutomationError({
								pluginSlug: plugin.slug,
								reason: "inactive_script",
								scriptSlug: binding.scriptSlug,
							});
						}
						resolved.push({
							sandboxScriptId: script.id,
							ruleId: providerEntityImportBindingId({
								index,
								entitySchemaSlug,
								pluginId: plugin.id,
								scriptSlug: binding.scriptSlug,
							}),
						});
					}
				}
				return resolved;
			});

			const findAutomation = Effect.fn("PluginRuntimeResolver.findAutomation")(function* (
				userId: UserId | null,
				id: AutomationRuleId,
			) {
				const binding = automationBindings(yield* bindingPlugins(userId)).find(
					(candidate) => bindingId(candidate) === id,
				);
				return binding ? yield* resolveAutomation(binding) : null;
			});

			return {
				findAutomation,
				listAutomations,
				findKernelScript,
				findActiveScript,
				findDetailsScript,
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
				resolvePrivatePluginCron,
				listPrivateCronSchedules,
				findSchemaProviderBySlug,
				resolveUserDetailsScript,
				findActiveWorkflowScript,
				findScriptAvailableToUser,
				findPluginAvailableToUser,
				listPluginsAvailableToUser,
				resolvePluginConfigContext,
				resolveUserTranslateScript,
				resolveSearchOptionsScript,
				findScriptInAvailablePlugin,
				findProviderAvailableToUser,
				findOperationAvailableToUser,
				resolveInstallationBootstrap,
				resolveUserSearchOptionsScript,
				isSystemProviderAvailableToUser,
				findAuthorizedSchemaProviderById,
				resolveActivePluginUserBootstrap,
				findProviderAvailableToUserBySlug,
				findWorkflowScriptAvailableToUser,
				findWorkflowScriptInAvailablePlugin,
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
