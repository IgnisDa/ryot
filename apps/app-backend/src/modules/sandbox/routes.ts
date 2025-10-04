import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../lib/contract";
import { notImplemented } from "../../lib/errors";

export const SandboxRoutesLive = HttpApiBuilder.group(AppContract, "sandbox", (handlers) =>
	handlers
		.handle("createScript", () => Effect.fail(notImplemented()))
		.handle("enqueue", () => Effect.fail(notImplemented()))
		.handle("getResult", () => Effect.fail(notImplemented())),
);
