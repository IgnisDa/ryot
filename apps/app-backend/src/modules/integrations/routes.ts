import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "~/lib/auth";
import { AppContract } from "~/lib/contract";
import { dieOnDbError } from "~/lib/errors";

import { IntegrationsService } from "./service";

export const IntegrationsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"integrations",
	(handlers) =>
		handlers
			.handle("list", ({ urlParams }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.list(user, urlParams).pipe(dieOnDbError);
				}),
			)
			.handle("create", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.create(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("get", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.get(user, path.integrationId).pipe(dieOnDbError);
				}),
			)
			.handle("update", ({ path, payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.update(user, path.integrationId, payload).pipe(dieOnDbError);
				}),
			)
			.handle("delete", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.delete(user, path.integrationId).pipe(dieOnDbError);
				}),
			)
			.handle("getRuns", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* IntegrationsService;
					return yield* service.listRuns(user, path.integrationId).pipe(dieOnDbError);
				}),
			)
			.handle("webhook", ({ path, payload }) =>
				Effect.gen(function* () {
					const service = yield* IntegrationsService;
					return yield* service
						.handleWebhook({ integrationId: path.integrationId, payload })
						.pipe(dieOnDbError);
				}),
			),
);
