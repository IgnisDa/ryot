import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { apiLifecycleCommand } from "#modules/automations/lifecycle/api-command";

import { CollectionOrderingService } from "./ordering-service";
import { CollectionsService } from "./service";

export const CollectionsRoutesLive = HttpApiBuilder.group(AppContract, "collections", (handlers) =>
	handlers
		.handle("reorderMembership", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* CollectionOrderingService;
				return yield* service.reorder(user, payload).pipe(dieOnDbError);
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
