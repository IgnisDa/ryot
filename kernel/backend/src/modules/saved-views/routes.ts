import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { SavedViewsService } from "./service";

export const SavedViewsRoutesLive = HttpApiBuilder.group(AppContract, "savedViews", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.create(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("update", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.update(user, payload.reference, payload).pipe(dieOnDbError);
			}),
		)
		.handle("delete", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.delete(user, payload.reference).pipe(dieOnDbError);
			}),
		)
		.handle("clone", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SavedViewsService;
				return yield* service.clone(user, payload.reference).pipe(dieOnDbError);
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
