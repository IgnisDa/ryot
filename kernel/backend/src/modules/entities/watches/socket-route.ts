import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { runEntityWatchSocketSession } from "./socket-session";

export const InterestSocketRouteLive = HttpRouter.add(
	"GET",
	"/entity-watches/ws",
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		const socket = yield* request.upgrade;
		yield* runEntityWatchSocketSession(socket).pipe(
			Effect.catchCause((cause) => Effect.logError("entity interest socket failed", cause)),
		);
		return HttpServerResponse.empty();
	}),
);
