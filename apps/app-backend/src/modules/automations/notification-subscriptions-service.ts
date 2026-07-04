import { DbError, conflict, notFound } from "@ryot/contract/errors";
import type {
	CatalogSignalSchema,
	InstalledNotificationRule,
} from "@ryot/contract/modules/automations/schemas";
import type { AutomationRuleId, SignalSchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { SignalSchemaSlug as SignalSchemaSlugBrand } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import {
	DefinitionRegistry,
	type SignalSchemaDefinition,
} from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { AutomationsRepository, type StoredNotificationSubscription } from "./repository";

export const NOTIFICATION_SCRIPT_SLUG = "automation.notification";

const toCatalogSignalSchema = (signalSchema: SignalSchemaDefinition): CatalogSignalSchema => ({
	name: signalSchema.name,
	slug: signalSchema.slug,
	propertiesSchema: signalSchema.propertiesSchema,
	id: SignalSchemaSlugBrand.make(signalSchema.slug),
});

const toInstalledNotificationRule = (
	state: StoredNotificationSubscription,
	signalSchema: SignalSchemaDefinition,
): InstalledNotificationRule => ({
	id: state.id,
	name: signalSchema.name,
	isActive: state.isActive,
	createdAt: state.createdAt,
	updatedAt: state.updatedAt,
	signalSchema: toCatalogSignalSchema(signalSchema),
});

export class NotificationSubscriptionsService extends Effect.Service<NotificationSubscriptionsService>()(
	"NotificationSubscriptionsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const definitions = yield* DefinitionRegistry;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const repository = yield* AutomationsRepository;
			const runInTransaction = yield* TransactionRunner;

			const loadNotificationScript = Effect.fn(
				"NotificationSubscriptionsService.loadNotificationScript",
			)(function* () {
				const script = yield* pluginRuntime.findKernelScript(NOTIFICATION_SCRIPT_SLUG);
				if (!script) {
					return yield* new DbError({ message: "Built-in notification script not found" });
				}
				return script;
			});

			const loadStateSignalSchema = Effect.fn(
				"NotificationSubscriptionsService.loadStateSignalSchema",
			)(function* (state: StoredNotificationSubscription) {
				const signalSchema = definitions.getSignalSchema(state.signalSchemaSlug);
				if (!signalSchema) {
					return yield* new DbError({ message: "Notification rule signal schema not found" });
				}
				return signalSchema;
			});

			const listCatalog = Effect.fn("NotificationSubscriptionsService.listCatalog")(() =>
				Effect.succeed(
					Object.values(definitions.getSnapshot().signalSchemas)
						.filter(({ catalogState }) => catalogState === "active")
						.map(toCatalogSignalSchema),
				),
			);

			const getCatalog = Effect.fn("NotificationSubscriptionsService.getCatalog")(function* (
				id: SignalSchemaSlug,
			) {
				const signalSchema = definitions.getSignalSchema(id);
				if (signalSchema?.catalogState !== "active") {
					return yield* notFound("Signal schema not found");
				}
				return toCatalogSignalSchema(signalSchema);
			});

			const listRules = Effect.fn("NotificationSubscriptionsService.listRules")(function* (
				userId: UserId,
			) {
				return yield* runWithDb(
					Effect.gen(function* () {
						const states = yield* repository.listNotificationSubscriptions(userId);
						const rules = yield* Effect.all(
							states.map((state) =>
								Effect.map(loadStateSignalSchema(state), (signalSchema) =>
									toInstalledNotificationRule(state, signalSchema),
								),
							),
						);
						return rules.sort(
							(left, right) =>
								left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
						);
					}),
				);
			});

			const loadRule = Effect.fn("NotificationSubscriptionsService.loadRule")(function* (input: {
				userId: UserId;
				ruleId: AutomationRuleId;
			}) {
				const state = yield* repository.findNotificationSubscription(input);
				if (!state) {
					return yield* notFound("Automation rule not found");
				}
				const signalSchema = yield* loadStateSignalSchema(state);
				return { state, signalSchema };
			});

			const getRule = Effect.fn("NotificationSubscriptionsService.getRule")(function* (input: {
				userId: UserId;
				ruleId: AutomationRuleId;
			}) {
				const loaded = yield* runWithDb(loadRule(input));
				return toInstalledNotificationRule(loaded.state, loaded.signalSchema);
			});

			const installRule = Effect.fn("NotificationSubscriptionsService.installRule")(
				function* (input: { userId: UserId; signalSchemaSlug: SignalSchemaSlug }) {
					return yield* runInTransaction(
						Effect.gen(function* () {
							const signalSchema = definitions.getSignalSchema(input.signalSchemaSlug);
							if (signalSchema?.catalogState !== "active") {
								return yield* notFound("Signal schema not found");
							}
							yield* loadNotificationScript();
							const state = yield* repository.insertNotificationSubscription({
								metadata: null,
								isActive: true,
								userId: input.userId,
								scriptSlug: NOTIFICATION_SCRIPT_SLUG,
								signalSchemaSlug: input.signalSchemaSlug,
							});
							return state
								? toInstalledNotificationRule(state, signalSchema)
								: yield* conflict("Notification rule already installed");
						}),
					);
				},
			);

			const ensureDefaultRules = Effect.fn("NotificationSubscriptionsService.ensureDefaultRules")(
				function* (userId: UserId) {
					return yield* runWithDb(
						Effect.gen(function* () {
							yield* loadNotificationScript();
							const schemas = Object.values(definitions.getSnapshot().signalSchemas).filter(
								({ catalogState }) => catalogState === "active",
							);
							for (const signalSchema of schemas) {
								yield* repository.insertNotificationSubscription({
									userId,
									metadata: null,
									isActive: true,
									scriptSlug: NOTIFICATION_SCRIPT_SLUG,
									signalSchemaSlug: SignalSchemaSlugBrand.make(signalSchema.slug),
								});
							}
						}),
					);
				},
			);

			const setRuleActive = Effect.fn("NotificationSubscriptionsService.setRuleActive")(
				function* (input: { userId: UserId; isActive: boolean; ruleId: AutomationRuleId }) {
					const state = yield* runInTransaction(
						repository.setNotificationSubscriptionActive(input),
					);
					if (!state) {
						return yield* notFound("Automation rule not found");
					}
					const signalSchema = yield* loadStateSignalSchema(state);
					return toInstalledNotificationRule(state, signalSchema);
				},
			);

			const deleteRule = Effect.fn("NotificationSubscriptionsService.deleteRule")(
				function* (input: { userId: UserId; ruleId: AutomationRuleId }) {
					const deleted = yield* runInTransaction(repository.deleteNotificationSubscription(input));
					return deleted ?? (yield* notFound("Automation rule not found"));
				},
			);

			return {
				getRule,
				listRules,
				deleteRule,
				getCatalog,
				installRule,
				listCatalog,
				setRuleActive,
				ensureDefaultRules,
			};
		}),
	},
) {}
