import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { EntitiesService } from "./service";

export const EntitiesRoutesLive = HttpApiBuilder.group(AppContract, "entities", (handlers) =>
	handlers.handle("create", ({ payload }) =>
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
	),
);
