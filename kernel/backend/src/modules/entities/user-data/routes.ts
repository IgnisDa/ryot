import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { apiLifecycleCommand } from "#modules/automations/lifecycle/api-command";

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
					const command = yield* apiLifecycleCommand(user, "entity-user-data:clear");
					return yield* service
						.clearEntityUserData(user, params.entityId, command)
						.pipe(dieOnDbError);
				}),
			)
			.handle("mergeEntityUserData", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityUserDataService;
					const command = yield* apiLifecycleCommand(user, "entity-user-data:merge");
					return yield* service
						.mergeEntityUserData(
							user,
							{ mergeFrom: payload.mergeFrom, mergeInto: payload.mergeInto },
							command,
						)
						.pipe(dieOnDbError);
				}),
			),
);
