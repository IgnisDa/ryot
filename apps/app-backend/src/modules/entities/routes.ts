import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { EntitiesService } from "./service";

export const EntitiesRoutesLive = HttpApiBuilder.group(AppContract, "entities", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;

				return yield* service
					.create({
						scope: "user",
						userId: user.id,
						name: payload.name,
						origin: { kind: "api" },
						externalId: payload.externalId,
						properties: payload.properties,
						providerId: payload.providerId,
						entitySchemaSlug: payload.entitySchemaSlug,
					})
					.pipe(dieOnDbError);
			}),
		)
		.handle("get", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;
				return yield* service.getById(user, path.entityId).pipe(dieOnDbError);
			}),
		),
);
