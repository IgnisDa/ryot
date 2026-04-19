import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../contract";
import { notImplemented } from "../../lib/errors";

export const CollectionsRoutesLive = HttpApiBuilder.group(AppContract, "collections", (handlers) =>
	handlers
		.handle("create", () => Effect.fail(notImplemented()))
		.handle("createMembership", () => Effect.fail(notImplemented()))
		.handle("deleteMembership", () => Effect.fail(notImplemented())),
);
