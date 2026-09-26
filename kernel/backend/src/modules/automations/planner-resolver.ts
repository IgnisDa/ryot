import { DbError } from "@ryot-app/contract/errors";
import type { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import type {
	PluginHook,
	PluginHookTarget,
	PluginManifest,
} from "@ryot-app/contract/modules/plugins/manifest";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginRepository } from "#modules/plugins/repository";

const plannedScriptFields = {
	id: tables.sandboxScript.id,
	slug: tables.sandboxScript.slug,
	metadata: tables.sandboxScript.metadata,
	contentHash: tables.sandboxScript.contentHash,
};

type PlannedAutomationScript = {
	[Field in keyof typeof plannedScriptFields]: (typeof tables.sandboxScript.$inferSelect)[Field];
};

type PlannerPlugin = {
	readonly id: string;
	readonly pluginRevisionId: string;
	readonly hooks: PluginManifest["hooks"];
	readonly scripts: PluginManifest["scripts"];
	readonly pluginConfigRevisionId: string | null;
	readonly signalSchemas: PluginManifest["signalSchemas"];
};

type TransactionCatalogMemo = {
	readonly lockedSets: Set<string>;
	readonly catalogs: Map<UserId | null, ReadonlyArray<PlannerPlugin>>;
};

const plannerPluginFields = {
	hooks: sql<PluginManifest["hooks"]>`${tables.pluginRevision.manifest} -> 'hooks'`,
	scripts: sql<PluginManifest["scripts"]>`${tables.pluginRevision.manifest} -> 'scripts'`,
	signalSchemas: sql<
		PluginManifest["signalSchemas"]
	>`${tables.pluginRevision.manifest} -> 'signalSchemas'`,
};

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
			const definitions = yield* DefinitionRepository;
			const lockCatalogUncached = Effect.fn(function* (users: ReadonlyArray<UserId | null>) {
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
					// Shared: planners coexist; PluginConfigRevisions.lock takes this same key exclusively.
					yield* mapDatabaseErrors(
						db.execute(
							sql`select pg_advisory_xact_lock_shared(hashtext(${"plugin-config:" + id}))`,
						),
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
			const catalogUncached = Effect.fn(function* (
				userId: UserId | null,
			): Effect.fn.Return<ReadonlyArray<PlannerPlugin>, DbError, Database> {
				const db = yield* Database;
				if (userId === null) {
					return yield* mapDatabaseErrors(
						db
							.select({
								...plannerPluginFields,
								id: tables.globalPlugin.pluginId,
								pluginRevisionId: tables.globalPlugin.activeRevisionId,
								pluginConfigRevisionId: tables.globalPlugin.configRevisionId,
							})
							.from(tables.globalPlugin)
							.innerJoin(
								tables.pluginRevision,
								eq(tables.pluginRevision.id, tables.globalPlugin.activeRevisionId),
							)
							.where(eq(tables.globalPlugin.isExecutable, true))
							.orderBy(asc(tables.globalPlugin.pluginId)),
					);
				}
				return yield* mapDatabaseErrors(
					db
						.select({
							...plannerPluginFields,
							id: tables.userPlugin.pluginId,
							pluginRevisionId: tables.userPlugin.activeRevisionId,
							pluginConfigRevisionId: tables.userPlugin.configRevisionId,
						})
						.from(tables.userPlugin)
						.innerJoin(
							tables.pluginRevision,
							eq(tables.pluginRevision.id, tables.userPlugin.activeRevisionId),
						)
						.innerJoin(
							tables.user,
							and(eq(tables.user.id, tables.userPlugin.userId), isNull(tables.user.disabledAt)),
						)
						.where(
							and(eq(tables.userPlugin.userId, userId), eq(tables.userPlugin.isExecutable, true)),
						)
						.orderBy(asc(tables.userPlugin.pluginId)),
				);
			});
			// `lockCatalogUncached` holds the `plugin-config:` advisory locks and the `for share` rows on
			// `plugin` and `plugin_installation` for the rest of the transaction, so no other transaction
			// can move the pointers a catalog read resolved: a second read within the same transaction
			// cannot observe anything different, so both are worth resolving once. Callers must plan
			// inside `database.transaction(...)`; entries are keyed on that transaction's `Database`
			// value and die with it.
			const memos = new WeakMap<object, TransactionCatalogMemo>();
			const memoFor = (db: object) => {
				const existing = memos.get(db);
				if (existing) {
					return existing;
				}
				const created: TransactionCatalogMemo = { catalogs: new Map(), lockedSets: new Set() };
				memos.set(db, created);
				return created;
			};
			const lockCatalog = Effect.fn(function* (users: ReadonlyArray<UserId | null>) {
				const db = yield* Database;
				const memo = memoFor(db);
				const key = [...new Set(users.map((id) => id ?? " system"))].sort().join("\u0000");
				if (memo.lockedSets.has(key)) {
					return;
				}
				yield* lockCatalogUncached(users);
				memo.lockedSets.add(key);
			});
			const catalog = Effect.fn(function* (userId: UserId | null) {
				const db = yield* Database;
				const memo = memoFor(db);
				const cached = memo.catalogs.get(userId);
				if (cached) {
					return cached;
				}
				const resolved = yield* catalogUncached(userId);
				memo.catalogs.set(userId, resolved);
				return resolved;
			});
			const resolve = Effect.fn(function* (
				trigger: AutomationTrigger,
				executionUserId: UserId | null,
			) {
				const db = yield* Database;
				const available = yield* catalog(executionUserId);
				const result: Array<{
					hook: PluginHook;
					plugin: PlannerPlugin | null;
					script: PlannedAutomationScript;
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
						? yield* definitions.findGlobalSignalSchema(signal.signalSchemaSlug)
						: null;
				const kernelSignal =
					kernelDefinition && kernelDefinition.pluginId == null ? kernelDefinition : null;
				const signalOwner =
					signal && signal.signalSchemaPluginId !== null
						? available.find(({ id }) => id === signal.signalSchemaPluginId)
						: null;
				const signalDefinition = signalOwner?.signalSchemas.find(
					({ slug }) => slug === signal?.signalSchemaSlug,
				);
				if (signal && !kernelSignal && !signalDefinition) {
					return result;
				}
				const isBatch = trigger.kind.operation === "batch";
				for (const plugin of available) {
					for (const hook of plugin.hooks) {
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
							plugin.signalSchemas.some(
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
						const declaration = plugin.scripts.find(({ slug }) => slug === hook.scriptSlug);
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
						const [script] = yield* mapDatabaseErrors(
							db
								.select(plannedScriptFields)
								.from(tables.sandboxScript)
								.where(
									and(
										eq(tables.sandboxScript.pluginRevisionId, plugin.pluginRevisionId),
										eq(tables.sandboxScript.slug, hook.scriptSlug),
									),
								),
						);
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
					const script = yield* repository.findKernelScript(slug);
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
