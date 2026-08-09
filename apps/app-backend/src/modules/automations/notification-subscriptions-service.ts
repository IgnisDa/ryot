import {
	AutomationConflictError,
	AutomationNotFoundError,
	type CatalogSignalSchema,
	type InstalledNotificationRule,
} from "@ryot/contract/modules/automations/schemas";
import type { AutomationRuleId, SignalSchemaSlug, UserId } from "@ryot/contract/schema/brands";
import { SignalSchemaSlug as SignalSchemaSlugBrand } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import type { SignalSchemaDefinition } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { AutomationsRepository, type StoredNotificationSubscription } from "./repository";

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

export class NotificationSubscriptionsService extends Context.Service<NotificationSubscriptionsService>()(
	"NotificationSubscriptionsService",
	{
		make: Effect.gen(function* () {
			const repository = yield* AutomationsRepository;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const effectiveForUser = (userId: UserId, includeUnavailable = false) =>
				pluginRuntime.getEffectiveDefinitions(userId, includeUnavailable);

			const resolveStateSignalSchema = Effect.fn(function* (state: StoredNotificationSubscription) {
				const effective = yield* effectiveForUser(state.userId, true);
				const definition = effective.signalSchemas[state.signalSchemaSlug];
				return (definition?.pluginId ?? null) === (state.signalSchemaPluginId ?? null)
					? definition
					: undefined;
			});

			const listCatalog = Effect.fn("NotificationSubscriptionsService.listCatalog")(
				(userId: UserId) =>
					effectiveForUser(userId).pipe(
						Effect.map((effectiveDefinitions) =>
							Object.values(effectiveDefinitions.signalSchemas)
								.filter(({ catalogState }) => catalogState === "active")
								.map(toCatalogSignalSchema),
						),
					),
			);

			const getCatalog = Effect.fn("NotificationSubscriptionsService.getCatalog")(function* (
				userId: UserId,
				id: SignalSchemaSlug,
			) {
				const effective = yield* effectiveForUser(userId);
				const signalSchema = effective.signalSchemas[id];
				if (signalSchema?.catalogState !== "active") {
					return yield* new AutomationNotFoundError({
						reason: { code: "signal-schema-not-found", signalSchemaSlug: id },
					});
				}
				return toCatalogSignalSchema(signalSchema);
			});

			const loadRule = Effect.fn("NotificationSubscriptionsService.loadRule")(function* (input: {
				userId: UserId;
				ruleId: AutomationRuleId;
			}) {
				const state = yield* repository.findNotificationSubscription(input);
				if (!state) {
					return yield* new AutomationNotFoundError({
						reason: { code: "rule-not-found", ruleId: input.ruleId },
					});
				}
				const signalSchema = yield* resolveStateSignalSchema(state);
				if (!signalSchema) {
					return yield* new AutomationNotFoundError({
						reason: { code: "rule-not-found", ruleId: input.ruleId },
					});
				}
				return { state, signalSchema };
			});

			const installRule = Effect.fn("NotificationSubscriptionsService.installRule")(
				function* (input: { userId: UserId; signalSchemaSlug: SignalSchemaSlug }) {
					const database = yield* Database;
					return yield* mapDatabaseErrors(
						database.transaction((transaction) =>
							Effect.gen(function* () {
								const signalSchema = (yield* effectiveForUser(input.userId)).signalSchemas[
									input.signalSchemaSlug
								];
								if (signalSchema?.catalogState !== "active") {
									return yield* new AutomationNotFoundError({
										reason: {
											code: "signal-schema-not-found",
											signalSchemaSlug: input.signalSchemaSlug,
										},
									});
								}
								const state = yield* repository.insertNotificationSubscription({
									metadata: null,
									isActive: true,
									userId: input.userId,
									signalSchemaSlug: input.signalSchemaSlug,
									signalSchemaPluginId: signalSchema.pluginId ?? null,
								});
								return state
									? toInstalledNotificationRule(state, signalSchema)
									: yield* new AutomationConflictError({
											reason: {
												code: "rule-already-installed",
												signalSchemaSlug: input.signalSchemaSlug,
											},
										});
							}).pipe(Effect.provideService(Database, transaction)),
						),
					);
				},
			);

			const ensureDefaultRules = Effect.fn("NotificationSubscriptionsService.ensureDefaultRules")(
				function* (userId: UserId) {
					return yield* Effect.gen(function* () {
						const schemas = Object.values((yield* effectiveForUser(userId)).signalSchemas).filter(
							({ catalogState }) => catalogState === "active",
						);
						for (const signalSchema of schemas) {
							yield* repository.insertNotificationSubscription({
								userId,
								metadata: null,
								isActive: true,
								signalSchemaPluginId: signalSchema.pluginId ?? null,
								signalSchemaSlug: SignalSchemaSlugBrand.make(signalSchema.slug),
							});
						}
					});
				},
			);

			const setRuleActive = Effect.fn("NotificationSubscriptionsService.setRuleActive")(
				function* (input: { userId: UserId; isActive: boolean; ruleId: AutomationRuleId }) {
					const database = yield* Database;
					return yield* mapDatabaseErrors(
						database.transaction((transaction) =>
							Effect.gen(function* () {
								const loaded = yield* loadRule(input);
								const state = yield* repository.setNotificationSubscriptionActive(input);
								if (!state) {
									return yield* new AutomationNotFoundError({
										reason: { code: "rule-not-found", ruleId: input.ruleId },
									});
								}
								return toInstalledNotificationRule(state, loaded.signalSchema);
							}).pipe(Effect.provideService(Database, transaction)),
						),
					);
				},
			);

			const deleteRule = Effect.fn("NotificationSubscriptionsService.deleteRule")(
				function* (input: { userId: UserId; ruleId: AutomationRuleId }) {
					const database = yield* Database;
					const deleted = yield* mapDatabaseErrors(
						database.transaction((transaction) =>
							repository
								.deleteNotificationSubscription(input)
								.pipe(Effect.provideService(Database, transaction)),
						),
					);
					return (
						deleted ??
						(yield* new AutomationNotFoundError({
							reason: { code: "rule-not-found", ruleId: input.ruleId },
						}))
					);
				},
			);

			return {
				deleteRule,
				getCatalog,
				installRule,
				listCatalog,
				setRuleActive,
				ensureDefaultRules,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
