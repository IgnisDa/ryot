import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { AdminAccess } from "../../lib/auth";

export const GodModeRoutesLive = HttpApiBuilder.group(AppContract, "god-mode", (handlers) =>
	handlers.handle("systemStatus", () =>
		Effect.gen(function* () {
			yield* AdminAccess;
			return { status: "ok" as const, timestamp: new Date().toISOString() };
		}),
	),
);
