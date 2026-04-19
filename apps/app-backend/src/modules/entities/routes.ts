import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../lib/contract";
import { notImplemented } from "../../lib/errors";

export const EntitiesRoutesLive = HttpApiBuilder.group(AppContract, "entities", (handlers) =>
	handlers
		.handle("create", () => Effect.fail(notImplemented()))
		.handle("get", () => Effect.fail(notImplemented()))
		.handle("clearUserState", () => Effect.fail(notImplemented()))
		.handle("import", () => Effect.fail(notImplemented()))
		.handle("getImportResult", () => Effect.fail(notImplemented())),
);
