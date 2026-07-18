import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";

import { EntitiesService } from "./service";

export const EntitiesRoutesLive = HttpApiBuilder.group(AppContract, "entities", (handlers) =>
	handlers.handle("create", ({ payload }) =>
		Effect.gen(function* () {
			const user = yield* CurrentUser;
			const service = yield* EntitiesService;
			const lifecycle = rootLifecycleCommand({
				source: "api",
				itemIdentity: "entity",
				initiator: { id: user.id, kind: "user" },
				executionId: AutomationExecutionId.make(generateId()),
				occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
			});

			return yield* service
				.create({
					lifecycle,
					scope: "user",
					userId: user.id,
					name: payload.name,
					externalId: payload.externalId,
					properties: payload.properties,
					providerId: payload.providerId,
					entitySchemaSlug: payload.entitySchemaSlug,
				})
				.pipe(dieOnDbError);
		}),
	),
);
