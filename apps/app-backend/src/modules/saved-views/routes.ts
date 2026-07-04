import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { SavedViewsService } from "./service";

export const SavedViewsRoutesLive = HttpApiBuilder.group(AppContract, "savedViews", (handlers) =>
	handlers
		.handle("list", ({ urlParams }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service
					.list(user, {
						pluginSlug: urlParams.pluginSlug,
						includeDisabled: urlParams.includeDisabled,
					})
					.pipe(dieOnDbError);
			}),
		)
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.create(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("get", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.get(user, path.viewSlug).pipe(dieOnDbError);
			}),
		)
		.handle("update", ({ path, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.update(user, path.viewSlug, payload).pipe(dieOnDbError);
			}),
		)
		.handle("delete", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.delete(user, path.viewSlug).pipe(dieOnDbError);
			}),
		)
		.handle("clone", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.clone(user, path.viewSlug).pipe(dieOnDbError);
			}),
		)
		.handle("reorder", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.reorder(user, payload).pipe(dieOnDbError);
			}),
		),
);
