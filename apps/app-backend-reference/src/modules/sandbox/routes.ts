import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { CurrentUser } from "../../lib/auth";
import { SandboxApiService } from "./service";

export const SandboxRoutesLive = HttpApiBuilder.group(AppContract, "sandbox", (handlers) =>
	handlers
		.handle("run", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SandboxApiService;
				return yield* service.run(user, payload);
			}),
		)
		.handle("get", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SandboxApiService;
				return yield* service.get(user, path.runId);
			}),
		),
);
