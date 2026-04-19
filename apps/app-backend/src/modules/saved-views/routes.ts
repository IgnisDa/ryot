import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { notImplemented } from "../../lib/errors";

export const SavedViewsRoutesLive = HttpApiBuilder.group(AppContract, "saved-views", (handlers) =>
	handlers
		.handle("list", () => Effect.fail(notImplemented()))
		.handle("create", () => Effect.fail(notImplemented()))
		.handle("get", () => Effect.fail(notImplemented()))
		.handle("update", () => Effect.fail(notImplemented()))
		.handle("delete", () => Effect.fail(notImplemented()))
		.handle("clone", () => Effect.fail(notImplemented()))
		.handle("reorder", () => Effect.fail(notImplemented())),
);
