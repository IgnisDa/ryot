import type {
	AutomationOperation,
	AutomationRuleKind,
	AutomationRuleMetadata,
} from "@ryot/contract/modules/automations/schemas";
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
import type { PluginProviderOperation } from "@ryot/plugin-kit/manifest";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Data, Effect, Layer } from "effect";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb, dbEffect } from "#lib/infrastructure/db/service";
import type { AutomationRuleTarget } from "#modules/automations/repository";

import { bootConfiguredPluginSlugs } from "./boot-sources";
import { PluginLoader, PluginLoaderLive } from "./loader";

export type PluginSnapshot = ReturnType<PluginLoader["getSnapshot"]>;

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

const activeScripts = (snapshot: PluginSnapshot) =>
	Object.entries(snapshot.plugins).flatMap(([pluginSlug, plugin]) =>
		plugin.scripts.map((script) => ({ ...script, pluginSlug })),
	);

export const findActiveScriptInPluginSnapshot = Effect.fn(
	"PluginRuntimeResolver.findActiveScriptInPluginSnapshot",
)(function* (
	snapshot: PluginSnapshot,
	input: { pluginSlug: string; scriptSlug: string; providerId?: string },
) {
	const active = snapshot.plugins[input.pluginSlug]?.scripts.find(
		({ slug }) => slug === input.scriptSlug,
	);
	if (!active) {
		return null;
	}
	const db = yield* CurrentDb;
	const [row] = yield* dbEffect(() =>
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
	snapshot: PluginSnapshot,
	input: { pluginSlug: string; workflowSlug: string },
) => {
	const scriptSlug = snapshot.plugins[input.pluginSlug]?.manifest.workflows.find(
		({ slug }) => slug === input.workflowSlug,
	)?.scriptSlug;
	return scriptSlug
		? findActiveScriptInPluginSnapshot(snapshot, { pluginSlug: input.pluginSlug, scriptSlug })
		: Effect.succeed(null);
};

export class PluginRuntimeResolver extends Effect.Service<PluginRuntimeResolver>()(
	"PluginRuntimeResolver",
	{
		effect: Effect.gen(function* () {
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
					const scriptSlug =
						cron.lot === "script"
							? cron.scriptSlug
							: plugin.manifest.workflows.find(({ slug }) => slug === cron.workflowSlug)
									?.scriptSlug;
					if (!scriptSlug) {
						return null;
					}
					const script = yield* findActiveScriptInPluginSnapshot(snapshot, {
						pluginSlug: input.pluginSlug,
						scriptSlug,
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
			)(function* (snapshot: PluginSnapshot, scriptId: SandboxScriptId) {
				const db = yield* CurrentDb;
				const [stored] = yield* dbEffect(() =>
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
				const [row] = yield* dbEffect(() =>
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
				const db = yield* CurrentDb;
				const [stored] = yield* dbEffect(() =>
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
			const resolveSystemQueryActivity = Effect.fn(
				"PluginRuntimeResolver.resolveSystemQueryActivity",
			)(function* (scriptId: SandboxScriptId) {
				const snapshot = loader.getSnapshot();
				const db = yield* CurrentDb;
				const [script] = yield* dbEffect(() =>
					db
						.select()
						.from(schema.sandboxScript)
						.where(eq(schema.sandboxScript.id, scriptId))
						.limit(1),
				);
				if (!script?.pluginSlug || script.metadata.kind !== "activity") {
					return null;
				}
				const plugin = snapshot.plugins[script.pluginSlug];
				const active = plugin?.scripts.find(
					(candidate) =>
						candidate.slug === script.slug && candidate.contentHash === script.contentHash,
				);
				if (!plugin || active?.metadata.kind !== "activity") {
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
			});

			const findKernelScript = Effect.fn("PluginRuntimeResolver.findKernelScript")(function* (
				scriptSlug: string,
			) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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
			)(function* (snapshot: PluginSnapshot, providerSlug: string) {
				const active = Object.entries(snapshot.plugins).find(([, plugin]) =>
					plugin.manifest.providers.some(({ slug }) => slug === providerSlug),
				);
				if (!active) {
					return null;
				}
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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
			)(function* (snapshot: PluginSnapshot, providerId: SandboxProviderId) {
				const db = yield* CurrentDb;
				const [row] = yield* dbEffect(() =>
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
					)
				) {
					return null;
				}
				return { ...row, id: SandboxProviderId.make(row.id) };
			});

			const findSchemaProviderBySlug = Effect.fn("PluginRuntimeResolver.findSchemaProviderBySlug")(
				function* (providerSlug: string) {
					const snapshot = loader.getSnapshot();
					const link = snapshot.bindings.schemaProviderLinks.find(
						(candidate) => candidate.providerSlug === providerSlug,
					);
					if (!link) {
						return null;
					}
					const provider = yield* findActiveProviderInSnapshot(snapshot, providerSlug);
					return provider
						? { provider, entitySchemaSlug: EntitySchemaSlug.make(link.entitySchemaSlug) }
						: null;
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
					!snapshot.bindings.schemaProviderLinks.some(
						(link) =>
							link.providerSlug === provider.slug &&
							link.entitySchemaSlug === input.entitySchemaSlug,
					)
				) {
					return null;
				}
				return { provider, entitySchemaSlug: EntitySchemaSlug.make(input.entitySchemaSlug) };
			});

			const listSchemaProviders = Effect.fn("PluginRuntimeResolver.listSchemaProviders")(function* (
				entitySchemaSlugs?: ReadonlyArray<string>,
			) {
				const snapshot = loader.getSnapshot();
				const links = snapshot.bindings.schemaProviderLinks
					.filter((link) => !entitySchemaSlugs || entitySchemaSlugs.includes(link.entitySchemaSlug))
					.sort(
						(left, right) =>
							left.entitySchemaSlug.localeCompare(right.entitySchemaSlug) ||
							left.providerSlug.localeCompare(right.providerSlug),
					);
				const forEachLinks = Effect.forEach(links, (link) =>
					Effect.gen(function* () {
						const provider = yield* findActiveProviderInSnapshot(snapshot, link.providerSlug);
						return provider
							? { provider, entitySchemaSlug: EntitySchemaSlug.make(link.entitySchemaSlug) }
							: null;
					}),
				).pipe(Effect.map((values) => values.filter((value) => value !== null)));
				const resolved = yield* forEachLinks;
				return resolved.sort(
					(left, right) =>
						left.entitySchemaSlug.localeCompare(right.entitySchemaSlug) ||
						left.provider.slug.localeCompare(right.provider.slug),
				);
			});

			const findProviderOperationScriptInSnapshot = Effect.fn(
				"PluginRuntimeResolver.findProviderOperationScriptInSnapshot",
			)(function* (
				snapshot: PluginSnapshot,
				providerId: SandboxProviderId,
				operation: PluginProviderOperation,
			) {
				const provider = yield* findActiveProviderByIdInSnapshot(snapshot, providerId);
				if (!provider) {
					return { provider: null, script: null, reason: "inactive_provider" as const };
				}
				const declared = snapshot.plugins[provider.pluginSlug]?.manifest.providers.find(
					({ slug }) => slug === provider.slug,
				);
				const scriptSlug = declared?.operations[operation];
				if (!scriptSlug) {
					return { provider, script: null, reason: "unsupported_operation" as const };
				}
				const script = yield* findActiveScriptInPluginSnapshot(snapshot, {
					scriptSlug,
					providerId,
					pluginSlug: provider.pluginSlug,
				});
				return script
					? { provider, script, reason: null }
					: { provider, script: null, reason: "script_unavailable" as const };
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
			const resolveSearchScript = resolveOperation("search");
			const resolveDetailsScript = resolveOperation("details");
			const resolveResolveScript = resolveOperation("resolve");
			const resolveTranslateScript = resolveOperation("translate");

			const automationBindings = (snapshot: PluginSnapshot): ReadonlyArray<BindingAutomation> => {
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
							metadata: binding.metadata?.inheritedProperties
								? { inheritedProperties: [...binding.metadata.inheritedProperties] }
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
				snapshot: PluginSnapshot,
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
				resolveTranslateScript,
				resolveActivePluginBoot,
				resolveActivePluginCron,
				findSchemaProviderBySlug,
				findActiveWorkflowScript,
				resolveSystemQueryActivity,
				findAuthorizedSchemaProviderById,
				findActivePluginConfigByScriptId,
				resolveActivePluginUserBootstrap,
				resolveTrustedUserBootstrapCaller,
			};
		}),
	},
) {}

export const PluginRuntimeResolverLive = PluginRuntimeResolver.Default.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
