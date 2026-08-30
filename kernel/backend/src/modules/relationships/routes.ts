import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";

import { RelationshipsService } from "./service";

export const RelationshipsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"relationships",
	(handlers) =>
		handlers.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* RelationshipsService;
				const command = rootLifecycleCommand({
					source: "api",
					itemIdentity: "relationship",
					initiator: { id: user.id, kind: "user" },
					executionId: AutomationExecutionId.make(generateId()),
					occurredAt: (yield* DateTime.nowAsDate).toISOString(),
				});
				return yield* service.createUser(user.id, payload, command);
			}).pipe(dieOnDbError),
		),
);
