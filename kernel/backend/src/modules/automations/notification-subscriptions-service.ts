import {
	AutomationConflictError,
	AutomationNotFoundError,
} from "@ryot-app/contract/modules/automations/schemas";
import type {
	NotificationSubscriptionId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { SignalSchemaSlug as SignalSchemaSlugBrand } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { DefinitionRepository } from "#modules/definition-registry/repository";

import { AutomationsRepository, type StoredNotificationSubscription } from "./repository";

export class NotificationSubscriptionsService extends Context.Service<NotificationSubscriptionsService>()(
	"NotificationSubscriptionsService",
	{
		make: Effect.gen(function* () {
			const repository = yield* AutomationsRepository;
			const definitions = yield* DefinitionRepository;
			const listActiveSignalSchemas = (userId: UserId) =>
				definitions
					.listUserSignalSchemas(userId)
					.pipe(
						Effect.map((signals) =>
							signals.filter(({ catalogState }) => catalogState === "active"),
						),
					);

			const resolveStateSignalSchema = Effect.fn(function* (state: StoredNotificationSubscription) {
				const definition = yield* definitions.findUserSignalSchema(
					state.userId,
					state.signalSchemaSlug,
					{ listed: true },
				);
				return (definition?.pluginId ?? null) === (state.signalSchemaPluginId ?? null)
					? definition
					: undefined;
			});

			const loadRule = Effect.fn("NotificationSubscriptionsService.loadRule")(function* (input: {
				userId: UserId;
				ruleId: NotificationSubscriptionId;
			}) {
				const state = yield* repository.findNotificationSubscription(input);
				if (!state) {
					return yield* new AutomationNotFoundError({
						reason: { ruleId: input.ruleId, code: "rule-not-found" },
					});
				}
				const signalSchema = yield* resolveStateSignalSchema(state);
				if (!signalSchema) {
					return yield* new AutomationNotFoundError({
						reason: { ruleId: input.ruleId, code: "rule-not-found" },
					});
				}
				return undefined;
			});

			const installRule = Effect.fn("NotificationSubscriptionsService.installRule")(
				function* (input: { userId: UserId; signalSchemaSlug: SignalSchemaSlug }) {
					const database = yield* Database;
					return yield* mapDatabaseErrors(
						database.transaction((transaction) =>
							Effect.gen(function* () {
								const signalSchema = yield* definitions.findUserSignalSchema(
									input.userId,
									input.signalSchemaSlug,
								);
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
									? { id: state.id }
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
						const schemas = yield* listActiveSignalSchemas(userId);
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
				function* (input: {
					userId: UserId;
					isActive: boolean;
					ruleId: NotificationSubscriptionId;
				}) {
					const database = yield* Database;
					return yield* mapDatabaseErrors(
						database.transaction((transaction) =>
							Effect.gen(function* () {
								yield* loadRule(input);
								const state = yield* repository.setNotificationSubscriptionActive(input);
								if (!state) {
									return yield* new AutomationNotFoundError({
										reason: { ruleId: input.ruleId, code: "rule-not-found" },
									});
								}
								return { id: state.id };
							}).pipe(Effect.provideService(Database, transaction)),
						),
					);
				},
			);

			const deleteRule = Effect.fn("NotificationSubscriptionsService.deleteRule")(
				function* (input: { userId: UserId; ruleId: NotificationSubscriptionId }) {
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
							reason: { ruleId: input.ruleId, code: "rule-not-found" },
						}))
					);
				},
			);

			return { deleteRule, installRule, setRuleActive, ensureDefaultRules };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
