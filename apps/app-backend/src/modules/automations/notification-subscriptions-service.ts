import { DbError, conflict, notFound } from "@ryot/contract/errors";
import type {
	CatalogSignalSchema,
	InstalledNotificationRule,
} from "@ryot/contract/modules/automations/schemas";
import type { AutomationRuleId, SignalSchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import {
	SignalSchemasRepository,
	type SignalSchemaScope,
} from "#modules/signals/signal-schemas-repository";

import { AutomationsRepository, type StoredAutomationRule } from "./repository";
import { AutomationsService } from "./service";

export const NOTIFICATION_SCRIPT_SLUG = "automation.notification";

const toCatalogSignalSchema = (signalSchema: SignalSchemaScope): CatalogSignalSchema => ({
	id: signalSchema.id,
	name: signalSchema.name,
	slug: signalSchema.slug,
	propertiesSchema: signalSchema.propertiesSchema,
});

const toInstalledNotificationRule = (
	rule: StoredAutomationRule,
	signalSchema: SignalSchemaScope,
): InstalledNotificationRule => ({
	id: rule.id,
	name: rule.name,
	isActive: rule.isActive,
	createdAt: rule.createdAt,
	updatedAt: rule.updatedAt,
	signalSchema: toCatalogSignalSchema(signalSchema),
});

export class NotificationSubscriptionsService extends Effect.Service<NotificationSubscriptionsService>()(
	"NotificationSubscriptionsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const automations = yield* AutomationsService;
			const repository = yield* AutomationsRepository;
			const runInTransaction = yield* TransactionRunner;
			const signalSchemas = yield* SignalSchemasRepository;

			const loadNotificationScript = Effect.fn(
				"NotificationSubscriptionsService.loadNotificationScript",
			)(function* () {
				const script = yield* repository.findBuiltinScriptBySlug(NOTIFICATION_SCRIPT_SLUG);
				if (!script) {
					return yield* new DbError({ message: "Built-in notification script not found" });
				}
				return script;
			});

			const loadRuleSignalSchema = Effect.fn(
				"NotificationSubscriptionsService.loadRuleSignalSchema",
			)(function* (rule: StoredAutomationRule) {
				if (rule.target.kind !== "signal_schema") {
					return yield* new DbError({ message: "Notification rule has an invalid target" });
				}
				const signalSchema = yield* signalSchemas.findBuiltinById(rule.target.id);
				if (!signalSchema) {
					return yield* new DbError({ message: "Notification rule signal schema not found" });
				}
				return signalSchema;
			});

			const listCatalog = Effect.fn("NotificationSubscriptionsService.listCatalog")(function* () {
				const schemas = yield* runWithDb(signalSchemas.listActiveBuiltins());
				return schemas.map(toCatalogSignalSchema);
			});

			const getCatalog = Effect.fn("NotificationSubscriptionsService.getCatalog")(function* (
				id: SignalSchemaSlug,
			) {
				const signalSchema = yield* runWithDb(signalSchemas.findActiveBuiltinById(id));
				return signalSchema
					? toCatalogSignalSchema(signalSchema)
					: yield* notFound("Signal schema not found");
			});

			const listRules = Effect.fn("NotificationSubscriptionsService.listRules")(function* (
				userId: UserId,
			) {
				return yield* runWithDb(
					Effect.gen(function* () {
						const script = yield* loadNotificationScript();
						const rules = yield* repository.listUserNotificationRules({
							userId,
							sandboxScriptId: script.id,
						});
						return yield* Effect.all(
							rules.map((rule) =>
								Effect.map(loadRuleSignalSchema(rule), (signalSchema) =>
									toInstalledNotificationRule(rule, signalSchema),
								),
							),
						);
					}),
				);
			});

			const loadRule = Effect.fn("NotificationSubscriptionsService.loadRule")(function* (input: {
				userId: UserId;
				ruleId: AutomationRuleId;
			}) {
				const script = yield* loadNotificationScript();
				const rule = yield* repository.findUserNotificationRule({
					...input,
					sandboxScriptId: script.id,
				});
				if (!rule) {
					return yield* notFound("Automation rule not found");
				}
				const signalSchema = yield* loadRuleSignalSchema(rule);
				return { rule, signalSchema };
			});

			const getRule = Effect.fn("NotificationSubscriptionsService.getRule")(function* (input: {
				userId: UserId;
				ruleId: AutomationRuleId;
			}) {
				const loaded = yield* runWithDb(loadRule(input));
				return toInstalledNotificationRule(loaded.rule, loaded.signalSchema);
			});

			const installRule = Effect.fn("NotificationSubscriptionsService.installRule")(
				function* (input: { userId: UserId; signalSchemaSlug: SignalSchemaSlug }) {
					return yield* runInTransaction(
						Effect.gen(function* () {
							const signalSchema = yield* signalSchemas.findActiveBuiltinById(
								input.signalSchemaSlug,
							);
							if (!signalSchema) {
								return yield* notFound("Signal schema not found");
							}
							const script = yield* loadNotificationScript();
							const rule = yield* repository.insertRule({
								position: null,
								metadata: null,
								isActive: true,
								isBuiltin: false,
								operation: "signal",
								userId: input.userId,
								kind: "subscription",
								name: signalSchema.name,
								sandboxScriptId: script.id,
								target: { id: signalSchema.id, kind: "signal_schema" },
							});
							return rule
								? toInstalledNotificationRule(rule, signalSchema)
								: yield* conflict("Notification rule already installed");
						}),
					);
				},
			);

			const ensureDefaultRules = Effect.fn("NotificationSubscriptionsService.ensureDefaultRules")(
				function* (userId: UserId) {
					return yield* runWithDb(
						Effect.gen(function* () {
							const script = yield* loadNotificationScript();
							const schemas = yield* signalSchemas.listActiveBuiltins();
							for (const signalSchema of schemas) {
								yield* repository.insertRule({
									userId,
									position: null,
									metadata: null,
									isActive: true,
									isBuiltin: false,
									operation: "signal",
									kind: "subscription",
									name: signalSchema.name,
									sandboxScriptId: script.id,
									target: { id: signalSchema.id, kind: "signal_schema" },
								});
							}
						}),
					);
				},
			);

			const setRuleActive = Effect.fn("NotificationSubscriptionsService.setRuleActive")(
				function* (input: { userId: UserId; isActive: boolean; ruleId: AutomationRuleId }) {
					const loaded = yield* runWithDb(loadRule(input));
					const rule = yield* automations.setUserRuleActive(input);
					return toInstalledNotificationRule(rule, loaded.signalSchema);
				},
			);

			const deleteRule = Effect.fn("NotificationSubscriptionsService.deleteRule")(
				function* (input: { userId: UserId; ruleId: AutomationRuleId }) {
					yield* runWithDb(loadRule(input));
					return yield* automations.deleteUserRule(input);
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
