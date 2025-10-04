import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../lib/contract";
import { notImplemented } from "../../lib/errors";

export const GodModeRoutesLive = HttpApiBuilder.group(AppContract, "god-mode", (handlers) =>
	handlers
		.handle("listUsers", () => Effect.fail(notImplemented()))
		.handle("provisionUser", () => Effect.fail(notImplemented()))
		.handle("resetUserPassword", () => Effect.fail(notImplemented()))
		.handle("setUserBan", () => Effect.fail(notImplemented())),
);
