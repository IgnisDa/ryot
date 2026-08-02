import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { LocalStreamConnections } from "./connections";
import { InterestService } from "./service";
import { EntityInterestStore } from "./store";
import { buildInterestStreamResponse } from "./stream";

export const InterestRoutesLive = HttpApiBuilder.group(AppContract, "entity-interest", (handlers) =>
	handlers
		.handleRaw("stream", ({ query }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const store = yield* EntityInterestStore;
				const connections = yield* LocalStreamConnections;
				return buildInterestStreamResponse(query.streamId, user, connections, store);
			}),
		)
		.handle("declareInterest", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* InterestService;
				return yield* service.declareInterest(user, payload).pipe(dieOnDbError);
			}),
		),
);
