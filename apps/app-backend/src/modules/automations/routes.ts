import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { AutomationsService } from "./service";

export const AutomationsRoutesLive = HttpApiBuilder.group(AppContract, "automations", (handlers) =>
	handlers
		.handle("installNotificationRule", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.installNotificationRule(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("listSignals", ({ urlParams }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.listSignals(user, urlParams).pipe(dieOnDbError);
			}),
		)
		.handle("getSignal", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.getSignal(user, path.signalId).pipe(dieOnDbError);
			}),
		)
		.handle("listSubscriptionRuns", ({ urlParams }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.listSubscriptionRuns(user, urlParams).pipe(dieOnDbError);
			}),
		)
		.handle("getSubscriptionRun", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.getSubscriptionRun(user, path.runId).pipe(dieOnDbError);
			}),
		)
		.handle("listSignalSchemas", () =>
			Effect.gen(function* () {
				yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.listSignalSchemas().pipe(dieOnDbError);
			}),
		)
		.handle("getSignalSchema", ({ path }) =>
			Effect.gen(function* () {
				yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.getSignalSchema(path.signalSchemaId).pipe(dieOnDbError);
			}),
		)
		.handle("listRules", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.listRules(user).pipe(dieOnDbError);
			}),
		)
		.handle("getRule", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.getRule(user, path.ruleId).pipe(dieOnDbError);
			}),
		)
		.handle("createRule", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.createRule(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("updateRule", ({ path, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.updateRule(user, path.ruleId, payload).pipe(dieOnDbError);
			}),
		)
		.handle("deleteRule", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.deleteRule(user, path.ruleId).pipe(dieOnDbError);
			}),
		)
		.handle("listCustomSignalSchemas", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.listCustomSignalSchemas(user).pipe(dieOnDbError);
			}),
		)
		.handle("getCustomSignalSchema", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.getCustomSignalSchema(user, path.signalSchemaId).pipe(dieOnDbError);
			}),
		)
		.handle("createCustomSignalSchema", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service.createCustomSignalSchema(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("archiveCustomSignalSchema", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AutomationsService;
				return yield* service
					.archiveCustomSignalSchema(user, path.signalSchemaId)
					.pipe(dieOnDbError);
			}),
		),
);
