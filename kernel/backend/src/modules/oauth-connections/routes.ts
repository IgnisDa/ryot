import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { OAuthConnectionsService } from "./service";

export const OAuthConnectionsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"oauthConnections",
	(handlers) =>
		handlers
			.handle("create", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					return yield* (yield* OAuthConnectionsService).create(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("complete", ({ params, payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					return yield* (yield* OAuthConnectionsService)
						.complete(user, params.connectionId, payload.secret)
						.pipe(dieOnDbError);
				}),
			)
			.handle("status", ({ params }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					return yield* (yield* OAuthConnectionsService)
						.status(user, params.connectionId)
						.pipe(dieOnDbError);
				}),
			)
			.handleRaw("callback", ({ query, params }) =>
				Effect.gen(function* () {
					const location = yield* (yield* OAuthConnectionsService).callback(params, query);
					return HttpServerResponse.redirect(location, {
						status: 302,
						headers: {
							"cache-control": "no-store",
							"referrer-policy": "no-referrer",
							"x-content-type-options": "nosniff",
						},
					});
				}),
			),
);
