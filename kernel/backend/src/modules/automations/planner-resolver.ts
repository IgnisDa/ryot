import { DbError } from "@ryot-app/contract/errors";
import type { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	PluginManifest,
	type PluginHook,
	type PluginHookTarget,
} from "@ryot-app/contract/modules/plugins/manifest";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import { UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { PluginEnvironmentConfig } from "#lib/infrastructure/plugin-environment-config";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { activePluginFields } from "#modules/plugins/persisted-projections";
import { PluginRepository } from "#modules/plugins/repository";
import type { AvailablePlugin } from "#modules/plugins/runtime-resolver";

type LifecyclePayload = NonNullable<AutomationTrigger["payload"]>;
type BatchPayload = Extract<LifecyclePayload, { operation: "batch" }>;
type ItemPayload = Exclude<LifecyclePayload, BatchPayload>;

const targetSnapshot = (payload: ItemPayload) => {
	if (payload.category === "request") {
		return payload.draft;
	}
	if (payload.resource === "signal" || payload.resource === "provider-entity-import") {
		return payload;
	}
	return payload.operation === "delete" ? payload.before : payload.after;
};

const matchesItem = (target: PluginHookTarget, payload: ItemPayload): boolean => {
	if (target.resource !== payload.resource || target.operation !== payload.operation) {
		return false;
	}
	const snapshot = targetSnapshot(payload);
	switch (target.resource) {
		case "entity":
		case "provider-entity-import":
			return (
				"entitySchemaSlug" in snapshot && snapshot.entitySchemaSlug === target.entitySchemaSlug
			);
		case "event":
			return (
				"eventSchemaSlug" in snapshot &&
				snapshot.eventSchemaSlug === target.eventSchemaSlug &&
				snapshot.entitySchemaSlug === target.entitySchemaSlug
			);
		case "relationship":
			return (
				"relationshipSchemaSlug" in snapshot &&
				snapshot.relationshipSchemaSlug === target.relationshipSchemaSlug
			);
		case "signal":
			return (
				"signalSchemaSlug" in snapshot && snapshot.signalSchemaSlug === target.signalSchemaSlug
			);
		default:
			return false;
	}
};

const matchesTarget = (target: PluginHookTarget, trigger: AutomationTrigger): boolean => {
	const payload = trigger.payload;
	if (!payload) {
		return false;
	}
	return payload.operation === "batch"
		? payload.items.some((item) => matchesItem(target, item))
		: matchesItem(target, payload);
};

export class AutomationPlannerResolver extends Context.Service<AutomationPlannerResolver>()(
	"AutomationPlannerResolver",
	{
		make: Effect.gen(function* () {
			const repository = yield* PluginRepository;
			const registry = yield* DefinitionRegistry;
			const environmentConfig = yield* PluginEnvironmentConfig;
			const lockCatalog = Effect.fn(function* (users: ReadonlyArray<UserId | null>) {
				yield* repository.lockIngestionShared();
				const db = yield* Database;
				const userIds = users.filter((id) => id !== null);
				const rows = yield* mapDatabaseErrors(
					db
						.select({ id: tables.plugin.id })
						.from(tables.plugin)
						.where(
							and(
								eq(tables.plugin.status, "active"),
								or(
									users.includes(null) ? eq(tables.plugin.scope, "system") : sql`false`,
									userIds.length
										? inArray(
												tables.plugin.id,
												db
													.select({ pluginId: tables.pluginInstallation.pluginId })
													.from(tables.pluginInstallation)
													.where(inArray(tables.pluginInstallation.userId, userIds)),
											)
										: sql`false`,
								),
							),
						)
						.orderBy(asc(tables.plugin.id)),
				);
				for (const { id } of rows) {
					yield* mapDatabaseErrors(
						db.execute(sql`select pg_advisory_xact_lock(hashtext(${"plugin-config:" + id}))`),
					);
				}
				const ids = rows.map(({ id }) => id);
				if (!ids.length) {
					return;
				}
				yield* mapDatabaseErrors(
					db
						.select({ id: tables.plugin.id })
						.from(tables.plugin)
						.where(inArray(tables.plugin.id, ids))
						.orderBy(asc(tables.plugin.id))
						.for("share"),
				);
				if (userIds.length) {
					yield* mapDatabaseErrors(
						db
							.select({ id: tables.pluginInstallation.id })
							.from(tables.pluginInstallation)
							.where(
								and(
									inArray(tables.pluginInstallation.pluginId, ids),
									inArray(tables.pluginInstallation.userId, userIds),
								),
							)
							.orderBy(asc(tables.pluginInstallation.pluginId), asc(tables.pluginInstallation.id))
							.for("share"),
					);
				}
			});
			const catalog = Effect.fn(function* (userId: UserId | null) {
				const db = yield* Database;
				if (userId !== null) {
					const [user] = yield* mapDatabaseErrors(
						db
							.select({ id: tables.user.id })
							.from(tables.user)
							.where(and(eq(tables.user.id, userId), isNull(tables.user.disabledAt))),
					);
					if (!user) {
						return [];
					}
				}
				const rows = yield* mapDatabaseErrors(
					db
						.select(activePluginFields)
						.from(tables.plugin)
						.where(eq(tables.plugin.status, "active"))
						.orderBy(asc(tables.plugin.id)),
				);
				const installations =
					userId === null
						? []
						: yield* mapDatabaseErrors(
								db
									.select()
									.from(tables.pluginInstallation)
									.where(
										and(
											eq(tables.pluginInstallation.userId, userId),
											isNull(tables.pluginInstallation.uninstalledAt),
											eq(tables.pluginInstallation.health, "ready"),
											eq(tables.pluginInstallation.isDisabled, false),
										),
									),
							);
				const result: AvailablePlugin[] = [];
				for (const row of rows) {
					const installation = installations.find(({ pluginId }) => pluginId === row.id);
					if (
						!row.activeRevisionId ||
						(userId !== null && !installation) ||
						(row.scope === "user" && (userId === null || row.ownerId !== userId))
					) {
						continue;
					}
					const environment = row.scope === "system" ? environmentConfig.find(row.id) : undefined;
					if (environment && environment.pluginRevisionId !== row.activeRevisionId) {
						yield* Effect.logWarning(
							`Environment configuration for plugin ${row.slug} targets plugin revision ${environment.pluginRevisionId} instead of the active ${row.activeRevisionId}`,
						);
					}
					const configId =
						row.scope === "system"
							? environment?.configRevisionId
							: installation?.activeConfigRevisionId;
					if (!configId) {
						continue;
					}
					const [config] = yield* mapDatabaseErrors(
						db
							.select()
							.from(tables.pluginConfigRevision)
							.where(eq(tables.pluginConfigRevision.id, configId)),
					);
					if (
						!config ||
						config.pluginRevisionId !== row.activeRevisionId ||
						config.payloadPrunedAt !== null ||
						config.encryptedPayload === null ||
						(row.scope === "system"
							? config.scope !== "environment" ||
								config.ownerUserId !== null ||
								config.pluginInstallationId !== null
							: config.scope !== "installation" ||
								config.ownerUserId !== userId ||
								config.pluginInstallationId !== installation?.id)
					) {
						continue;
					}
					const manifest = yield* decodeStoredSchema(
						row.manifest,
						PluginManifest,
						`Invalid active plugin manifest ${row.id}`,
					);
					result.push({
						manifest,
						id: row.id,
						slug: row.slug,
						health: "ready",
						scope: row.scope,
						isDisabled: false,
						sourceHash: row.sourceHash,
						pluginConfigRevisionId: configId,
						compiledHashes: row.compiledHashes,
						pluginRevisionId: row.activeRevisionId,
						installationId: installation?.id ?? "",
						ownerUserId: row.ownerId === null ? null : UserId.make(row.ownerId),
					});
				}
				return result;
			});
			const resolve = Effect.fn(function* (
				trigger: AutomationTrigger,
				executionUserId: UserId | null,
			) {
				const db = yield* Database;
				const available = yield* catalog(executionUserId);
				const result: Array<{
					hook: PluginHook;
					plugin: AvailablePlugin | null;
					script: typeof tables.sandboxScript.$inferSelect;
					executionUserId: UserId | null;
				}> = [];
				const signal = trigger.payload?.resource === "signal" ? trigger.payload : null;
				const preferences =
					signal && executionUserId !== null
						? yield* mapDatabaseErrors(
								db
									.select()
									.from(tables.notificationSubscription)
									.where(
										and(
											eq(tables.notificationSubscription.userId, executionUserId),
											eq(tables.notificationSubscription.signalSchemaSlug, signal.signalSchemaSlug),
											signal.signalSchemaPluginId === null
												? isNull(tables.notificationSubscription.signalSchemaPluginId)
												: eq(
														tables.notificationSubscription.signalSchemaPluginId,
														signal.signalSchemaPluginId,
													),
										),
									)
									.orderBy(asc(tables.notificationSubscription.id))
									.for("share"),
							)
						: [];
				const kernelDefinition =
					signal?.signalSchemaPluginId === null
						? registry.getSignalSchema(signal.signalSchemaSlug)
						: null;
				const kernelSignal =
					kernelDefinition && kernelDefinition.pluginId == null ? kernelDefinition : null;
				const signalOwner =
					signal && signal.signalSchemaPluginId !== null
						? available.find(({ id }) => id === signal.signalSchemaPluginId)
						: null;
				const signalDefinition = signalOwner?.manifest.signalSchemas.find(
					({ slug }) => slug === signal?.signalSchemaSlug,
				);
				if (signal && !kernelSignal && !signalDefinition) {
					return result;
				}
				const isBatch = trigger.kind.operation === "batch";
				for (const plugin of available) {
					for (const hook of plugin.manifest.hooks) {
						if (
							hook.stage !== (trigger.kind.category === "request" ? "before" : "after") ||
							(hook.causationSources && !hook.causationSources.includes(trigger.causation.source))
						) {
							continue;
						}
						if (
							hook.stage === "after" &&
							(((hook.frequency ?? "item") === "batch") !== isBatch ||
								(hook.executionScope === "user" && executionUserId === null) ||
								(hook.executionScope === "global" && executionUserId !== null))
						) {
							continue;
						}
						if (!hook.targets.some((target) => matchesTarget(target, trigger))) {
							continue;
						}
						const notification =
							signal &&
							plugin.manifest.signalSchemas.some(
								(definition) =>
									definition.slug === signal.signalSchemaSlug &&
									definition.notificationHookSlug === hook.slug,
							);
						if (
							notification &&
							(signalOwner?.id !== plugin.id ||
								(signalDefinition ?? kernelSignal)?.catalogState !== "active" ||
								!preferences.some((p) => p.isActive && p.signalSchemaPluginId === plugin.id))
						) {
							continue;
						}
						const declaration = plugin.manifest.scripts.find(
							({ slug }) => slug === hook.scriptSlug,
						);
						if (
							declaration?.kind !== "automation" ||
							declaration.automationType !== (hook.stage === "before" ? "policy" : "automation") ||
							(hook.stage === "before" &&
								declaration.capabilities.some(
									(capability) =>
										!POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability),
								))
						) {
							return yield* new DbError({
								message: `Invalid automation hook script ${plugin.id}/${hook.slug}`,
							});
						}
						const hash = plugin.compiledHashes[hook.scriptSlug];
						const [script] = hash
							? yield* mapDatabaseErrors(
									db
										.select()
										.from(tables.sandboxScript)
										.where(
											and(
												eq(tables.sandboxScript.pluginRevisionId, plugin.pluginRevisionId),
												eq(tables.sandboxScript.slug, hook.scriptSlug),
												eq(tables.sandboxScript.contentHash, hash),
											),
										),
								)
							: [];
						if (script?.metadata.kind !== "automation") {
							return yield* new DbError({
								message: `Missing automation script ${plugin.id}/${hook.slug}`,
							});
						}
						result.push({ hook, plugin, script, executionUserId });
					}
				}
				if (
					kernelSignal?.catalogState === "active" &&
					signal?.signalSchemaSlug === "integration.disabled" &&
					executionUserId !== null &&
					preferences.some((p) => p.isActive && p.signalSchemaPluginId === null)
				) {
					const [user] = yield* mapDatabaseErrors(
						db
							.select({ id: tables.user.id })
							.from(tables.user)
							.where(and(eq(tables.user.id, executionUserId), isNull(tables.user.disabledAt))),
					);
					if (!user) {
						return result;
					}
					const slug = kernelSignal.notificationHookSlug;
					const hash = yield* repository.getKernelScriptContentHash(slug);
					const [script] = hash
						? yield* mapDatabaseErrors(
								db
									.select()
									.from(tables.sandboxScript)
									.where(
										and(
											isNull(tables.sandboxScript.pluginRevisionId),
											eq(tables.sandboxScript.slug, slug),
											eq(tables.sandboxScript.contentHash, hash),
										),
									),
							)
						: [];
					if (script?.metadata.kind !== "automation") {
						return yield* new DbError({ message: "Kernel notification script is unavailable" });
					}
					result.push({
						script,
						plugin: null,
						executionUserId,
						hook: {
							slug,
							stage: "after",
							scriptSlug: slug,
							delivery: "async",
							name: kernelSignal.name,
							targets: [
								{
									operation: "emit",
									resource: "signal",
									signalSchemaSlug: signal.signalSchemaSlug,
								},
							],
						},
					});
				}
				return result;
			});
			return { resolve, lockCatalog };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
