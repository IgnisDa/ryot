import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { CurrentUser } from "../../lib/auth";
import { TrackersService } from "./service";

export const TrackersRoutesLive = HttpApiBuilder.group(AppContract, "trackers", (handlers) =>
	handlers
		.handle("list", ({ urlParams }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* TrackersService;
				return yield* service
					.list(user, urlParams.includeDisabled)
					.pipe(Effect.catchTag("DbError", (error) => Effect.die(error)));
			}),
		)
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* TrackersService;
				return yield* service
					.create(user, payload)
					.pipe(Effect.catchTag("DbError", (error) => Effect.die(error)));
			}),
		)
		.handle("update", ({ path, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* TrackersService;
				return yield* service
					.update(user, path.trackerId, payload)
					.pipe(Effect.catchTag("DbError", (error) => Effect.die(error)));
			}),
		)
		.handle("reorder", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* TrackersService;
				return yield* service
					.reorder(user, payload)
					.pipe(Effect.catchTag("DbError", (error) => Effect.die(error)));
			}),
		),
);
