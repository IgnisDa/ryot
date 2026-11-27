import { AuthorizationContext, CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { LiveUpdates } from "./hub";

export const LiveUpdatesRoutesLive = HttpApiBuilder.group(AppContract, "live-updates", (handlers) =>
	handlers.handleRaw("events", () =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const authorization = yield* AuthorizationContext;
			const liveUpdates = yield* LiveUpdates;
			const sessionId =
				authorization.impersonation !== undefined && authorization.credential.kind === "oauth"
					? authorization.credential.sessionId
					: undefined;
			return HttpServerResponse.stream(
				liveUpdates.stream({ userId: user.id, ...(sessionId === undefined ? {} : { sessionId }) }),
				{
					headers: {
						connection: "keep-alive",
						"x-accel-buffering": "no",
						"cache-control": "no-cache",
						"content-type": "text/event-stream",
					},
				},
			);
		}),
	),
);
