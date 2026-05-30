import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { notImplemented } from "../../lib/errors";

export const QueryEngineRoutesLive = HttpApiBuilder.group(AppContract, "query-engine", (handlers) =>
	handlers.handle("execute", () => Effect.fail(notImplemented())),
);
