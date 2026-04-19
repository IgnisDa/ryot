import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { CurrentUser } from "../../lib/auth";
import { AudibleService } from "./service";

export const AudibleRoutesLive = HttpApiBuilder.group(AppContract, "audible", (handlers) =>
	handlers
		.handle("list", () =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AudibleService;
				return yield* service.list(user);
			}),
		)
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AudibleService;
				return yield* service.create(user, payload);
			}),
		)
		.handle("confirmImport", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AudibleService;
				return yield* service.confirmImport(user, path.runId);
			}),
		)
		.handle("get", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* AudibleService;
				return yield* service.get(user, path.runId);
			}),
		),
);
