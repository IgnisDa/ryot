import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { SavedViewsService } from "./service";

export const SavedViewsRoutesLive = HttpApiBuilder.group(AppContract, "savedViews", (handlers) =>
	handlers
		.handle("list", ({ query }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service
					.list(user, {
						pluginSlug: query.pluginSlug,
						includeDisabled: query.includeDisabled,
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
		.handle("get", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.get(user, params.viewSlug).pipe(dieOnDbError);
			}),
		)
		.handle("update", ({ params, payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.update(user, params.viewSlug, payload).pipe(dieOnDbError);
			}),
		)
		.handle("delete", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.delete(user, params.viewSlug).pipe(dieOnDbError);
			}),
		)
		.handle("clone", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.clone(user, params.viewSlug).pipe(dieOnDbError);
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
