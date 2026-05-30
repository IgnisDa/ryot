import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { notImplemented } from "../../lib/errors";

export const TrackersRoutesLive = HttpApiBuilder.group(AppContract, "trackers", (handlers) =>
	handlers
		.handle("list", () => Effect.fail(notImplemented()))
		.handle("create", () => Effect.fail(notImplemented()))
		.handle("update", () => Effect.fail(notImplemented()))
		.handle("reorder", () => Effect.fail(notImplemented())),
);
