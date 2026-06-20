import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { badRequest, dieOnDbError } from "@ryot/contract/errors";
import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { trimToNull } from "#lib/shared/validation";

import { EntitiesService } from "./service";

export const EntitiesRoutesLive = HttpApiBuilder.group(AppContract, "entities", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;
				const trimmedEntitySchemaId = trimToNull(payload.entitySchemaId);
				if (!trimmedEntitySchemaId) {
					return yield* badRequest("Entity schema id is required");
				}

				const externalId = payload.externalId
					? (trimToNull(payload.externalId) ?? undefined)
					: undefined;
				const trimmedScriptId = payload.sandboxScriptId
					? (trimToNull(payload.sandboxScriptId) ?? undefined)
					: undefined;
				const sandboxScriptId = trimmedScriptId ? SandboxScriptId.make(trimmedScriptId) : undefined;

				return yield* service
					.create({
						externalId,
						scope: "user",
						userId: user.id,
						sandboxScriptId,
						name: payload.name,
						properties: payload.properties,
						entitySchemaId: EntitySchemaId.make(trimmedEntitySchemaId),
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
