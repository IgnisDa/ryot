import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "../../lib/auth";
import { AppContract } from "../../lib/contract";
import { dieOnDbError } from "../../lib/errors";
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
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* TrackersService;
				return yield* service.create(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("update", ({ path, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* TrackersService;
				return yield* service.update(user, path.trackerId, payload).pipe(dieOnDbError);
			}),
		)
		.handle("reorder", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* TrackersService;
				return yield* service.reorder(user, payload).pipe(dieOnDbError);
			}),
		),
);
