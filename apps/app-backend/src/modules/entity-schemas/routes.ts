import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../lib/contract";
import { notImplemented } from "../../lib/errors";

export const EntitySchemasRoutesLive = HttpApiBuilder.group(
	AppContract,
	"entity-schemas",
	(handlers) =>
		handlers
			.handle("list", () => Effect.fail(notImplemented()))
			.handle("create", () => Effect.fail(notImplemented()))
			.handle("get", () => Effect.fail(notImplemented()))
			.handle("search", () => Effect.fail(notImplemented()))
			.handle("getSearchResult", () => Effect.fail(notImplemented())),
);
