import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { PageAuthoringService } from "./service";

export const PageAuthoringRoutesLive = HttpApiBuilder.group(
	AppContract,
	"pageAuthoring",
	(handlers) =>
		handlers
			.handle("create", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					return yield* (yield* PageAuthoringService)
						.create({ kind: "user", userId: user.id }, payload)
						.pipe(dieOnDbError, Effect.catchTag("DatabaseSessionStateError", Effect.die));
				}),
			)
			.handle("replaceDraft", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					return yield* (yield* PageAuthoringService)
						.replaceDraft({ kind: "user", userId: user.id }, payload)
						.pipe(dieOnDbError, Effect.catchTag("DatabaseSessionStateError", Effect.die));
				}),
			)
			.handle("compile", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					return yield* (yield* PageAuthoringService)
						.compile(user.id, payload)
						.pipe(dieOnDbError, Effect.catchTag("DatabaseSessionStateError", Effect.die));
				}),
			)
			.handle("publish", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					return yield* (yield* PageAuthoringService)
						.publish(user.id, payload)
						.pipe(dieOnDbError, Effect.catchTag("DatabaseSessionStateError", Effect.die));
				}),
			)
			.handle("setWriteAccess", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					return yield* (yield* PageAuthoringService)
						.setWriteAccess(user.id, payload.pageId, payload.writeAccess)
						.pipe(dieOnDbError, Effect.catchTag("DatabaseSessionStateError", Effect.die));
				}),
			)
			.handle("delete", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					return yield* (yield* PageAuthoringService)
						.remove(user.id, payload.pageId)
						.pipe(dieOnDbError, Effect.catchTag("DatabaseSessionStateError", Effect.die));
				}),
			),
);
