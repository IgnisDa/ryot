import type {
	AutomationOperation,
	AutomationRuleKind,
	AutomationRuleMetadata,
} from "@ryot/contract/modules/automations/schemas";
import type { PluginProviderOperation } from "@ryot/contract/modules/plugins/manifest";
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
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";

import { bootConfiguredPluginSlugs } from "./boot-sources";
import { PluginLoader, PluginLoaderLive, type PluginRegistrySnapshot } from "./loader";

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

const activeScripts = (snapshot: PluginRegistrySnapshot) =>
	Object.entries(snapshot.plugins).flatMap(([pluginSlug, plugin]) =>
		plugin.scripts.map((script) => ({ ...script, pluginSlug })),
	);

export const findActiveScriptInPluginSnapshot = Effect.fn(
	"PluginRuntimeResolver.findActiveScriptInPluginSnapshot",
)(function* (
	snapshot: PluginRegistrySnapshot,
	input: { pluginSlug: string; scriptSlug: string; providerId?: string },
) {
	const active = snapshot.plugins[input.pluginSlug]?.scripts.find(
		({ slug }) => slug === input.scriptSlug,
	);
	if (!active) {
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
					eq(schema.sandboxScript.pluginSlug, input.pluginSlug),
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

export class PluginRuntimeResolver extends Context.Service<PluginRuntimeResolver>()(
	"PluginRuntimeResolver",
	{
		make: Effect.gen(function* () {
			const loader = yield* PluginLoader;

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
						pluginSlug: input.pluginSlug,
						scriptSlug: boot.scriptSlug,
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
						.select({
							slug: schema.sandboxScript.slug,
							pluginSlug: schema.sandboxScript.pluginSlug,
						})
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				if (!stored?.pluginSlug) {
					return null;
				}
				const active = activeScripts(snapshot).find(
					(script) => script.pluginSlug === stored.pluginSlug && script.slug === stored.slug,
				);
				if (!active) {
					return null;
				}
				const [row] = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.sandboxScript)
						.where(
							and(
								eq(schema.sandboxScript.slug, active.slug),
								eq(schema.sandboxScript.pluginSlug, active.pluginSlug),
								eq(schema.sandboxScript.contentHash, active.contentHash),
							),
						)
						.limit(1),
				);
				return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
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
							slug: schema.sandboxScript.slug,
							pluginSlug: schema.sandboxScript.pluginSlug,
							contentHash: schema.sandboxScript.contentHash,
						})
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				if (!stored?.pluginSlug || !bootConfiguredPluginSlugs.has(stored.pluginSlug)) {
					return null;
				}
				const plugin = snapshot.plugins[stored.pluginSlug];
				const active = plugin?.scripts.find(
					(script) =>
						script.slug === stored.slug &&
						script.contentHash === stored.contentHash &&
						script.metadata.kind === "script",
				);
				if (
					!plugin ||
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
			const findActivePluginConfigByScriptId = Effect.fn(
				"PluginRuntimeResolver.findActivePluginConfigByScriptId",
			)(function* (scriptId: SandboxScriptId) {
				const snapshot = loader.getSnapshot();
				const script = yield* findActiveScriptByIdInSnapshot(snapshot, scriptId);
				if (!script?.pluginSlug) {
					return null;
				}
				const plugin = snapshot.plugins[script.pluginSlug];
				return plugin
					? { pluginSlug: script.pluginSlug, configSchema: plugin.manifest.configSchema }
					: null;
			});
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
					if (!script?.pluginSlug || script.metadata.kind !== "script") {
						return null;
					}
					const plugin = snapshot.plugins[script.pluginSlug];
					const active = plugin?.scripts.find(
						(candidate) =>
							candidate.slug === script.slug && candidate.contentHash === script.contentHash,
					);
					if (!plugin || active?.metadata.kind !== "script") {
						return null;
					}
					return {
						pluginSlug: script.pluginSlug,
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
								isNull(schema.sandboxScript.pluginSlug),
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
				const active = Object.entries(snapshot.plugins).find(([, plugin]) =>
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
								eq(schema.sandboxProvider.pluginSlug, active[0]),
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
					!snapshot.plugins[row.pluginSlug]?.manifest.providers.some(
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
						? {
								provider,
								entitySchemaSlug: EntitySchemaSlug.make(provider.rootEntitySchemaSlug),
							}
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
			) {
				const snapshot = loader.getSnapshot();
				const db = yield* Database;
				const activePluginSlugs = Object.keys(snapshot.plugins);
				const rows = yield* mapDatabaseErrors(
					db
						.select()
						.from(schema.sandboxProvider)
						.where(
							activePluginSlugs.length > 0
								? inArray(schema.sandboxProvider.pluginSlug, activePluginSlugs)
								: sql`false`,
						),
				);
				return rows
					.filter((provider) => {
						const plugin = snapshot.plugins[provider.pluginSlug];
						return (
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
							optionsSchema: schema.sandboxProviderOperation.optionsSchema,
							script: schema.sandboxScript,
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
					row.script.pluginSlug !== provider.pluginSlug ||
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
				kind: AutomationRuleKind;
				target: AutomationRuleTarget;
				operation: AutomationOperation;
			}) {
				const snapshot = loader.getSnapshot();
				const bindings = automationBindings(snapshot).filter(
					(binding) =>
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
				findDetailsScript,
				findActiveOperation,
				listSchemaProviders,
				resolveSearchScript,
				findActiveScriptById,
				resolveDetailsScript,
				resolveResolveScript,
				findActiveProviderById,
				resolveTranslateScript,
				resolveActivePluginBoot,
				resolveActivePluginCron,
				findSchemaProviderBySlug,
				findActiveWorkflowScript,
				resolveSystemQueryScript,
				resolveSearchOptionsScript,
				findAuthorizedSchemaProviderById,
				findActivePluginConfigByScriptId,
				resolveActivePluginUserBootstrap,
				resolveTrustedUserBootstrapCaller,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginRuntimeResolverLive = PluginRuntimeResolver.layer.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
