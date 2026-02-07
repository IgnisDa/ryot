import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { SandboxApiService } from "./service";

export const SandboxRoutesLive = HttpApiBuilder.group(AppContract, "sandbox", (handlers) =>
	handlers
		.handle("createScript", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SandboxApiService;
				return yield* service.createScript(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("enqueue", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SandboxApiService;
				return yield* service.enqueue(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("getResult", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* SandboxApiService;
				return yield* service.getResult(user, path.jobId).pipe(dieOnDbError);
			}),
		),
);
