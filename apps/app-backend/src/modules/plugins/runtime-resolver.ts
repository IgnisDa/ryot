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

import { PluginLoader, PluginLoaderLive } from "./loader";

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

export class PluginRuntimeResolver extends Effect.Service<PluginRuntimeResolver>()(
	"PluginRuntimeResolver",
	{
		effect: Effect.gen(function* () {
			const loader = yield* PluginLoader;

			const activeScripts = () =>
				Object.entries(loader.getSnapshot().plugins).flatMap(([pluginSlug, plugin]) =>
					plugin.scripts.map((script) => ({ ...script, pluginSlug })),
				);

			const findActiveScriptInPlugin = Effect.fn("PluginRuntimeResolver.findActiveScriptInPlugin")(
				function* (input: { pluginSlug: string; scriptSlug: string; providerId?: string }) {
					const active = loader
						.getSnapshot()
						.plugins[input.pluginSlug]?.scripts.find(({ slug }) => slug === input.scriptSlug);
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
									input.providerId
										? eq(schema.sandboxScript.providerId, input.providerId)
										: undefined,
								),
							)
							.limit(1),
					);
					return row ? { ...row, id: SandboxScriptId.make(row.id) } : null;
				},
			);

			const findActiveScript = Effect.fn("PluginRuntimeResolver.findActiveScript")(function* (
				scriptSlug: string,
			) {
				const active = activeScripts().find(({ slug }) => slug === scriptSlug);
				if (!active) {
					return null;
				}
				return yield* findActiveScriptInPlugin({
					scriptSlug: active.slug,
					pluginSlug: active.pluginSlug,
				});
			});

			const findActiveScriptById = Effect.fn("PluginRuntimeResolver.findActiveScriptById")(
				function* (scriptId: SandboxScriptId) {
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
					const active = activeScripts().find(
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
				},
			);

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

			const findActiveProvider = Effect.fn("PluginRuntimeResolver.findActiveProvider")(function* (
				providerSlug: string,
			) {
				const active = Object.entries(loader.getSnapshot().plugins).find(([, plugin]) =>
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

			const findActiveProviderById = Effect.fn("PluginRuntimeResolver.findActiveProviderById")(
				function* (providerId: SandboxProviderId) {
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
						!loader
							.getSnapshot()
							.plugins[row.pluginSlug]?.manifest.providers.some(({ slug }) => slug === row.slug)
					) {
						return null;
					}
					return { ...row, id: SandboxProviderId.make(row.id) };
				},
			);

			const schemaProviderLinks = () => loader.getSnapshot().bindings.schemaProviderLinks;

			const findSchemaProviderBySlug = Effect.fn("PluginRuntimeResolver.findSchemaProviderBySlug")(
				function* (providerSlug: string) {
					const link = schemaProviderLinks().find(
						(candidate) => candidate.providerSlug === providerSlug,
					);
					if (!link) {
						return null;
					}
					const provider = yield* findActiveProvider(providerSlug);
					return provider
						? { provider, entitySchemaSlug: EntitySchemaSlug.make(link.entitySchemaSlug) }
						: null;
				},
			);

			const listSchemaProviders = Effect.fn("PluginRuntimeResolver.listSchemaProviders")(function* (
				entitySchemaSlugs?: ReadonlyArray<string>,
			) {
				const links = schemaProviderLinks()
					.filter((link) => !entitySchemaSlugs || entitySchemaSlugs.includes(link.entitySchemaSlug))
					.sort(
						(left, right) =>
							left.entitySchemaSlug.localeCompare(right.entitySchemaSlug) ||
							left.providerSlug.localeCompare(right.providerSlug),
					);
				const resolved = yield* Effect.forEach(links, (link) =>
					Effect.gen(function* () {
						const provider = yield* findActiveProvider(link.providerSlug);
						return provider
							? { provider, entitySchemaSlug: EntitySchemaSlug.make(link.entitySchemaSlug) }
							: null;
					}),
				).pipe(Effect.map((values) => values.filter((value) => value !== null)));
				return resolved.sort(
					(left, right) =>
						left.entitySchemaSlug.localeCompare(right.entitySchemaSlug) ||
						left.provider.slug.localeCompare(right.provider.slug),
				);
			});

			const findProviderOperationScript = Effect.fn(
				"PluginRuntimeResolver.findProviderOperationScript",
			)(function* (providerId: SandboxProviderId, operation: PluginProviderOperation) {
				const provider = yield* findActiveProviderById(providerId);
				if (!provider) {
					return { provider: null, script: null, reason: "inactive_provider" as const };
				}
				const declared = loader
					.getSnapshot()
					.plugins[provider.pluginSlug]?.manifest.providers.find(
						({ slug }) => slug === provider.slug,
					);
				const scriptSlug = declared?.operations[operation];
				if (!scriptSlug) {
					return { provider, script: null, reason: "unsupported_operation" as const };
				}
				const script = yield* findActiveScriptInPlugin({
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
					findProviderOperationScript(providerId, operation).pipe(
						Effect.flatMap(({ provider, reason, script }) =>
							script
								? Effect.succeed(script)
								: Effect.fail(
										new UnsupportedProviderOperationError({
											providerId,
											operation,
											providerSlug: provider?.slug ?? null,
											reason,
										}),
									),
						),
					);
			const findDetailsScript = (providerId: SandboxProviderId) =>
				findProviderOperationScript(providerId, "details").pipe(Effect.map(({ script }) => script));
			const resolveSearchScript = resolveOperation("search");
			const resolveDetailsScript = resolveOperation("details");
			const resolveResolveScript = resolveOperation("resolve");
			const resolveTranslateScript = resolveOperation("translate");

			const automationBindings = (): ReadonlyArray<BindingAutomation> => {
				const bindings: BindingAutomation[] = [];
				for (const [pluginSlug, plugin] of Object.entries(loader.getSnapshot().plugins)) {
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
				binding: BindingAutomation,
			) {
				const script = yield* findActiveScript(binding.scriptSlug);
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
				const bindings = automationBindings().filter(
					(binding) =>
						binding.kind === input.kind &&
						binding.operation === input.operation &&
						binding.target.kind === input.target.kind &&
						binding.target.id === input.target.id,
				);
				return yield* Effect.forEach(bindings, resolveAutomation).pipe(
					Effect.map((resolved) => resolved.filter((value) => value !== null)),
				);
			});

			const findAutomation = Effect.fn("PluginRuntimeResolver.findAutomation")(function* (
				id: AutomationRuleId,
			) {
				const binding = automationBindings().find((candidate) => bindingId(candidate) === id);
				return binding ? yield* resolveAutomation(binding) : null;
			});

			return {
				findAutomation,
				listAutomations,
				findKernelScript,
				findActiveScript,
				findDetailsScript,
				listSchemaProviders,
				findActiveScriptById,
				resolveSearchScript,
				resolveDetailsScript,
				resolveResolveScript,
				resolveTranslateScript,
				findSchemaProviderBySlug,
			};
		}),
	},
) {}

export const PluginRuntimeResolverLive = PluginRuntimeResolver.Default.pipe(
	Layer.provideMerge(PluginLoaderLive),
);
