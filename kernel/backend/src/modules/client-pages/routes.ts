import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import { Effect, Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { ClientPagesService } from "./service";

export const ClientPagesRoutesLive = HttpApiBuilder.group(AppContract, "clientPages", (handlers) =>
	handlers
		.handle("prepare", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const prepared = yield* (yield* ClientPagesService)
					.prepare(user, payload.target)
					.pipe(dieOnDbError);
				return yield* Schema.decodeUnknownEffect(PreparedClientPage)(prepared).pipe(Effect.orDie);
			}),
		)
		.handle("checkFreshness", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return {
					current: yield* (yield* ClientPagesService)
						.isIdentityCurrent(user.id, payload.identity)
						.pipe(
							Effect.catchTags({ ClientPagePreparationError: () => Effect.succeed(false) }),
							dieOnDbError,
						),
				};
			}),
		)
		.handle("document", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				return yield* (yield* ClientPagesService)
					.document(user, payload.identity)
					.pipe(dieOnDbError);
			}),
		),
);
