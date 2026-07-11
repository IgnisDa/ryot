import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { CollectionsService } from "./service";

export const CollectionsRoutesLive = HttpApiBuilder.group(AppContract, "collections", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionsService;
				return yield* service.create(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("createMembership", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionsService;
				return yield* service.addToCollection(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("deleteMembership", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionsService;
				return yield* service.removeFromCollection(user, payload).pipe(dieOnDbError);
			}),
		),
);
