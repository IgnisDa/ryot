import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { IntegrationsService } from "./service";

export const IntegrationsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"integrations",
	(handlers) =>
		handlers
			.handle("list", ({ query }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.listForClient(user, query).pipe(dieOnDbError);
				}),
			)
			.handle("create", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.create(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("get", ({ params }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.getForClient(user, params.integrationId).pipe(dieOnDbError);
				}),
			)
			.handle("update", ({ params, payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service
						.updateForClient(user.id, params.integrationId, payload)
						.pipe(dieOnDbError);
				}),
			)
			.handle("delete", ({ params }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.delete(user, params.integrationId).pipe(dieOnDbError);
				}),
			)
			.handle("getRuns", ({ params }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.listRuns(user, params.integrationId).pipe(dieOnDbError);
				}),
			)
			.handle("webhook", ({ params, payload }) =>
				Effect.gen(function* () {
					const service = yield* IntegrationsService;
					return yield* service
						.handleWebhook({ payload, integrationId: params.integrationId })
						.pipe(dieOnDbError);
				}),
			),
);
