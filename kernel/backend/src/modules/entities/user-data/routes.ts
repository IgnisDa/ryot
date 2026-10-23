import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";

import { EntityUserDataService } from "./service";

export const EntityUserDataRoutesLive = HttpApiBuilder.group(
	AppContract,
	"entityUserData",
	(handlers) =>
		handlers
			.handle("clearEntityUserData", ({ params }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityUserDataService;
					const command = rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						itemIdentity: "entity-user-data:clear",
						initiator: { id: user.id, kind: "user" },
						accountGeneration: user.accountGeneration,
						executionId: AutomationExecutionId.make(generateId()),
						occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					});
					return yield* service
						.clearEntityUserData(user, params.entityId, command)
						.pipe(dieOnDbError);
				}),
			)
			.handle("mergeEntityUserData", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityUserDataService;
					const command = rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						itemIdentity: "entity-user-data:merge",
						initiator: { id: user.id, kind: "user" },
						accountGeneration: user.accountGeneration,
						executionId: AutomationExecutionId.make(generateId()),
						occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					});
					return yield* service.mergeEntityUserData(user, payload, command).pipe(dieOnDbError);
				}),
			),
);
