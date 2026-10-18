import { CurrentUser, type CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { requireOpenSubmission } from "#modules/mutations/submission-window";

import { CollectionOrderingService } from "./ordering-service";
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
		.handle("reorderMembership", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionOrderingService;
				yield* requireOpenSubmission(payload.submittedAt);
				const command = {
					...rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						occurredAt: payload.submittedAt,
						itemIdentity: "collection:reorder",
						initiator: { id: user.id, kind: "user" },
						accountGeneration: user.accountGeneration,
						executionId: AutomationExecutionId.make(
							`collection-reorder-${sha256Hex(stableStringify([user.id, payload.idempotencyKey]))}`,
						),
					}),
					writeContext: null,
				} satisfies DomainLifecycleCommand;
				return yield* service.reorder(user, payload, command).pipe(dieOnDbError);
			}),
		)
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionsService;
				const command = yield* apiLifecycleCommand(user, "collection:create");
				return yield* service.create(user, payload, command).pipe(dieOnDbError);
			}),
		)
		.handle("update", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionsService;
				const command = yield* apiLifecycleCommand(user, "collection:update");
				return yield* service.update(user, payload, command).pipe(dieOnDbError);
			}),
		)
		.handle("delete", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionsService;
				const command = yield* apiLifecycleCommand(user, "collection:delete");
				return yield* service.delete(user, payload, command).pipe(dieOnDbError);
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
