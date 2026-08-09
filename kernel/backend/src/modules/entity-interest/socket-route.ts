import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { runEntityInterestSocketSession } from "./socket-session";

export const InterestSocketRouteLive = HttpRouter.add(
	"GET",
	"/entity-interest/ws",
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		const socket = yield* request.upgrade;
		yield* runEntityInterestSocketSession(socket).pipe(
			Effect.catchCause((cause) => Effect.logError("entity interest socket failed", cause)),
		);
		return HttpServerResponse.empty();
	}),
);
