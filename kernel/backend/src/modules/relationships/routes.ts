import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { DbError, dieOnDbError } from "@ryot-app/contract/errors";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { DateTime, Effect, Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { ChangeSets } from "#modules/changes/service";

const isRouteFailure = Schema.is(
	Schema.Union([DbError, RelationshipBadRequest, RelationshipNotFound]),
);

export const RelationshipsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"relationships",
	(handlers) =>
		handlers.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				if (payload.relationshipSchema.owner.kind === "kernel") {
					return yield* new RelationshipBadRequest({ reason: { code: "kernel-owned-schema" } });
				}
				const command = {
					...rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						accountUserId: user.id,
						itemIdentity: "relationship",
						initiator: { id: user.id, kind: "user" },
						executionId: AutomationExecutionId.make(generateId()),
						occurredAt: (yield* DateTime.nowAsDate).toISOString(),
					}),
					writeContext: null,
				};
				const result = yield* (yield* ChangeSets).commit(
					{
						userId: user.id,
						relationships: {
							upserts: [
								{
									propertiesMode: "replace",
									itemIdentity: "relationship",
									properties: payload.properties ?? {},
									relationshipSchema: payload.relationshipSchema,
									source: { kind: "existing", entityId: payload.sourceEntityId },
									target: { kind: "existing", entityId: payload.targetEntityId },
								},
							],
						},
					},
					command,
				);
				return { relationship: result.relationships[0]?.relationship ?? null };
			}).pipe(
				Effect.catchIf((error) => !isRouteFailure(error), Effect.die),
				dieOnDbError,
			),
		),
);
