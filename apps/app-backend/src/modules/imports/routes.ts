import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { notImplemented } from "../../lib/errors";

export const ImportsRoutesLive = HttpApiBuilder.group(AppContract, "imports", (handlers) =>
	handlers
		.handle("createRun", () => Effect.fail(notImplemented()))
		.handle("listRuns", () => Effect.fail(notImplemented()))
		.handle("getRun", () => Effect.fail(notImplemented()))
		.handle("deleteRun", () => Effect.fail(notImplemented())),
);
