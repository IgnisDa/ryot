import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "~/lib/auth";
import { AppContract } from "~/lib/contract";
import { dieOnDbError } from "~/lib/errors";

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
