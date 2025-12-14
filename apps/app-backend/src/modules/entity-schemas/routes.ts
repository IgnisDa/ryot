import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "../../lib/auth";
import { AppContract } from "../../lib/contract";
import { dieOnDbError, notImplemented } from "../../lib/errors";
import { EntitySchemasService } from "./service";

export const EntitySchemasRoutesLive = HttpApiBuilder.group(
	AppContract,
	"entity-schemas",
	(handlers) =>
		handlers
			.handle("list", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntitySchemasService;
					return yield* service
						.list(user, { trackerId: payload.trackerId, slugs: payload.slugs })
						.pipe(dieOnDbError);
				}),
			)
			.handle("create", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntitySchemasService;
					return yield* service.create(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("get", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntitySchemasService;
					return yield* service.getById(user, path.entitySchemaId).pipe(dieOnDbError);
				}),
			)
			.handle("search", () => Effect.fail(notImplemented()))
			.handle("getSearchResult", () => Effect.fail(notImplemented())),
);
