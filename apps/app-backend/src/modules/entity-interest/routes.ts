import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { StreamRegistry } from "./registry";
import { InterestService } from "./service";
import { buildInterestStreamResponse } from "./stream";

export const InterestRoutesLive = HttpApiBuilder.group(AppContract, "entity-interest", (handlers) =>
	handlers
		.handleRaw("stream", ({ query }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const registry = yield* StreamRegistry;
				return buildInterestStreamResponse(query.streamId, user.id, registry);
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
