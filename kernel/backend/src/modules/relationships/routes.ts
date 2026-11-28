import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { DbError, dieOnDbError } from "@ryot-app/contract/errors";
import { PolicyFailure } from "@ryot-app/contract/modules/changes/policies";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { Effect, Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { apiLifecycleCommand } from "#modules/automations/lifecycle/api-command";
import { rejectKernelOwnedSchemas } from "#modules/changes/authority";
import { ChangeSets } from "#modules/changes/service";

const isRouteFailure = Schema.is(
	Schema.Union([DbError, PolicyFailure, RelationshipBadRequest, RelationshipNotFound]),
);

export const RelationshipsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"relationships",
	(handlers) =>
		handlers.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const command = yield* apiLifecycleCommand(user, "relationship");
				const changes = {
					userId: user.id,
					relationships: {
						upserts: [
							{
								itemIdentity: "relationship",
								propertiesMode: "replace" as const,
								properties: payload.properties ?? {},
								relationshipSchema: payload.relationshipSchema,
								...(payload.key === undefined ? {} : { key: payload.key }),
								source: { kind: "existing" as const, entityId: payload.sourceEntityId },
								target: { kind: "existing" as const, entityId: payload.targetEntityId },
							},
						],
					},
				};
				yield* rejectKernelOwnedSchemas(changes);
				const result = yield* (yield* ChangeSets).commit(changes, command);
				return { relationship: result.relationships[0]?.relationship ?? null };
			}).pipe(
				Effect.catchIf((error) => !isRouteFailure(error), Effect.die),
				dieOnDbError,
			),
		),
);
