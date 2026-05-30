import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { notImplemented } from "../../lib/errors";

export const SystemRoutesLive = HttpApiBuilder.group(AppContract, "system", (handlers) =>
	handlers
		.handle("health", () => Effect.succeed({ status: "healthy" as const }))
		.handle("config", () => Effect.fail(notImplemented())),
);
