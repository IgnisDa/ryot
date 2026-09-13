import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { NotificationSubscriptionsService } from "./notification-subscriptions-service";

export const AutomationsRoutesLive = HttpApiBuilder.group(AppContract, "automations", (handlers) =>
	handlers
		.handle("installRule", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service
					.installRule({ userId: user.id, signalSchemaSlug: payload.signalSchemaSlug })
					.pipe(dieOnDbError);
			}),
		)
		.handle("activateRule", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service
					.setRuleActive({ isActive: true, userId: user.id, ruleId: params.ruleId })
					.pipe(dieOnDbError);
			}),
		)
		.handle("deactivateRule", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service
					.setRuleActive({ isActive: false, userId: user.id, ruleId: params.ruleId })
					.pipe(dieOnDbError);
			}),
		)
		.handle("deleteRule", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* NotificationSubscriptionsService;
				return yield* service
					.deleteRule({ userId: user.id, ruleId: params.ruleId })
					.pipe(dieOnDbError);
			}),
		),
);
