import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { TrackersService } from "./service";

export const TrackersRoutesLive = HttpApiBuilder.group(AppContract, "trackers", (handlers) =>
	handlers
		.handle("list", ({ urlParams }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* TrackersService;
				return yield* service.list(user, urlParams.includeDisabled).pipe(dieOnDbError);
			}),
		)
		.handle("updateState", ({ path, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* TrackersService;
				return yield* service.updateState(user, path.trackerSlug, payload).pipe(dieOnDbError);
			}),
		),
);
