import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "~/lib/auth";
import { AppContract } from "~/lib/contract";
import { dieOnDbError } from "~/lib/errors";

import { EntitiesService } from "./service";

export const EntitiesRoutesLive = HttpApiBuilder.group(AppContract, "entities", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;
				return yield* service.create(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("get", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;
				return yield* service.getById(user, path.entityId).pipe(dieOnDbError);
			}),
		)
		.handle("clearUserState", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;
				return yield* service.clearUserState(user, path.entityId).pipe(dieOnDbError);
			}),
		)
		.handle("import", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;
				return yield* service.import(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("getImportResult", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;
				return yield* service.getImportResult(user, path.jobId);
			}),
		),
);
