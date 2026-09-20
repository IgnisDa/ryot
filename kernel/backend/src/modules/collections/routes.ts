import { CurrentUser, type CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";

import { CollectionsService } from "./service";

const apiLifecycleCommand = Effect.fnUntraced(function* (
	user: CurrentUserValue,
	itemIdentity: string,
) {
	return {
		...rootLifecycleCommand({
			itemIdentity,
			source: "api",
			lane: "interactive",
			accountGeneration: user.accountGeneration,
			executionId: AutomationExecutionId.make(generateId()),
			initiator: { kind: "user", id: user.accountGeneration.userId },
			occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
		}),
		writeContext: null,
	} satisfies DomainLifecycleCommand;
});

export const CollectionsRoutesLive = HttpApiBuilder.group(AppContract, "collections", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionsService;
				const command = yield* apiLifecycleCommand(user, "collection:create");
				return yield* service.create(user, payload, command).pipe(dieOnDbError);
			}),
		)
		.handle("createMembership", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionsService;
				const command = yield* apiLifecycleCommand(user, "collection:add-membership");
				return yield* service.addToCollection(user, payload, command).pipe(dieOnDbError);
			}),
		)
		.handle("deleteMembership", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionsService;
				const command = yield* apiLifecycleCommand(user, "collection:remove-membership");
				return yield* service.removeFromCollection(user, payload, command).pipe(dieOnDbError);
			}),
		),
);
