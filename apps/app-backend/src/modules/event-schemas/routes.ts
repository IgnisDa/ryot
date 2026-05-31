import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { EventSchemasService } from "./service";

export const EventSchemasRoutesLive = HttpApiBuilder.group(
	AppContract,
	"eventSchemas",
	(handlers) =>
		handlers
			.handle("list", ({ urlParams }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EventSchemasService;
					return yield* service.list(user, urlParams).pipe(dieOnDbError);
				}),
			)
			.handle("create", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EventSchemasService;
					return yield* service.create(user, payload).pipe(dieOnDbError);
				}),
			),
);
