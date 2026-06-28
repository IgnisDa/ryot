import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { NotificationSubscriptionsService } from "./notification-subscriptions-service";

export const AutomationsRoutesLive = HttpApiBuilder.group(AppContract, "automations", (handlers) =>
	handlers
		.handle("listCatalog", () =>
			Effect.gen(function* () {
				const service = yield* NotificationSubscriptionsService;
				return yield* service.listCatalog().pipe(dieOnDbError);
			}),
		)
		.handle("getCatalog", ({ path }) =>
			Effect.gen(function* () {
				const service = yield* NotificationSubscriptionsService;
				return yield* service.getCatalog(path.signalSchemaId).pipe(dieOnDbError);
			}),
		)
		.handle("listRules", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service.listRules(user.id).pipe(dieOnDbError);
			}),
		)
		.handle("getRule", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service.getRule({ userId: user.id, ruleId: path.ruleId }).pipe(dieOnDbError);
			}),
		)
		.handle("installRule", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service
					.installRule({ userId: user.id, signalSchemaId: payload.signalSchemaId })
					.pipe(dieOnDbError);
			}),
		)
		.handle("activateRule", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service
					.setRuleActive({ isActive: true, userId: user.id, ruleId: path.ruleId })
					.pipe(dieOnDbError);
			}),
		)
		.handle("deactivateRule", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service
					.setRuleActive({ isActive: false, userId: user.id, ruleId: path.ruleId })
					.pipe(dieOnDbError);
			}),
		)
		.handle("deleteRule", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service
					.deleteRule({ userId: user.id, ruleId: path.ruleId })
					.pipe(dieOnDbError);
			}),
		),
);
