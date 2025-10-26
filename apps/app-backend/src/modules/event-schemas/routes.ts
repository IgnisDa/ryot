import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "../../lib/auth";
import { AppContract } from "../../lib/contract";
import { dieOnDbError } from "../../lib/errors";
import { EventSchemasService } from "./service";

export const EventSchemasRoutesLive = HttpApiBuilder.group(
	AppContract,
	"event-schemas",
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
