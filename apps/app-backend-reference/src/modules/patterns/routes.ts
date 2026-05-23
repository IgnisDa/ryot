import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { CurrentUser } from "../../lib/auth";
import { PatternsService } from "./service";

export const PatternsRoutesLive = HttpApiBuilder.group(AppContract, "patterns", (handlers) =>
	handlers
		.handle("dbTransaction", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PatternsService;
				return yield* service.dbTransaction(user, payload);
			}),
		)
		.handle("uniqueConstraint", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* PatternsService;
				return yield* service.uniqueConstraint(user, payload);
			}),
		)
		.handle("filterCondition", ({ payload }) =>
			Effect.gen(function* () {
				yield* CurrentUser;
				const service = yield* PatternsService;
				return yield* service.filterCondition(payload);
			}),
		),
);
