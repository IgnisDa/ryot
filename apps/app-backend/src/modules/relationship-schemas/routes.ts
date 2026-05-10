import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth-middleware";
import { AppContract } from "#lib/contract";
import { dieOnDbError } from "#lib/errors";

import { RelationshipSchemasService } from "./service";

export const RelationshipSchemasRoutesLive = HttpApiBuilder.group(
	AppContract,
	"relationshipSchemas",
	(handlers) =>
		handlers
			.handle("list", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* RelationshipSchemasService;
					return yield* service.list(user, payload).pipe(dieOnDbError);
				}),
			)
			.handle("create", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* RelationshipSchemasService;
					return yield* service.create(user, payload).pipe(dieOnDbError);
				}),
			),
);
