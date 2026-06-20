import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { EntitySchemasService } from "./service";

export const EntitySchemasRoutesLive = HttpApiBuilder.group(
	AppContract,
	"entitySchemas",
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
			.handle("search", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntitySchemasService;
					return yield* service.search(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("getSearchResult", ({ path }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntitySchemasService;
					return yield* service.getSearchResult(user, path.jobId).pipe(dieOnDbError);
				}),
			),
);
