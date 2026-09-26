import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";

import { UserStateService } from "./service";

export const UserStateRoutesLive = HttpApiBuilder.group(AppContract, "userState", (handlers) =>
	handlers
		.handle("clearUserState", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserStateService;
				const command = rootLifecycleCommand({
					source: "api",
					itemIdentity: "user-state:clear",
					initiator: { id: user.id, kind: "user" },
					executionId: AutomationExecutionId.make(generateId()),
					occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
				});
				return yield* service.clearUserState(user, params.entityId, command).pipe(dieOnDbError);
			}),
		)
		.handle("mergeUserState", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UserStateService;
				const command = rootLifecycleCommand({
					source: "api",
					itemIdentity: "user-state:merge",
					initiator: { id: user.id, kind: "user" },
					executionId: AutomationExecutionId.make(generateId()),
					occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
				});
				return yield* service.mergeUserState(user, payload, command).pipe(dieOnDbError);
			}),
		),
);
