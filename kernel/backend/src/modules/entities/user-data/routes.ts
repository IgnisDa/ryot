import { CurrentUser, type CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import type { ClearEntityUserDataRequest } from "@ryot-app/contract/modules/entity-user-data/schemas";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";

import { EntityUserDataService } from "./service";

const userDataCommand = (
	user: CurrentUserValue,
	action: "clear" | "merge",
	submission: ClearEntityUserDataRequest,
) =>
	rootLifecycleCommand({
		source: "api",
		lane: "interactive",
		occurredAt: submission.submittedAt,
		initiator: { id: user.id, kind: "user" },
		accountGeneration: user.accountGeneration,
		itemIdentity: `entity-user-data:${action}`,
		executionId: AutomationExecutionId.make(
			`entity-user-data-${sha256Hex(stableStringify([user.id, action, submission.idempotencyKey]))}`,
		),
	});

export const EntityUserDataRoutesLive = HttpApiBuilder.group(
	AppContract,
	"entityUserData",
	(handlers) =>
		handlers
			.handle("clearEntityUserData", ({ params, payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityUserDataService;
					const command = userDataCommand(user, "clear", payload);
					return yield* service
						.clearEntityUserData(user, params.entityId, command)
						.pipe(dieOnDbError);
				}),
			)
			.handle("mergeEntityUserData", ({ payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser;
					const service = yield* EntityUserDataService;
					const command = userDataCommand(user, "merge", payload);
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
