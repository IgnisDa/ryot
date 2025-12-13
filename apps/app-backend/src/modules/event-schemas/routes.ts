import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../lib/contract";
import { notImplemented } from "../../lib/errors";

export const EventSchemasRoutesLive = HttpApiBuilder.group(
	AppContract,
	"event-schemas",
	(handlers) =>
		handlers
			.handle("list", () => Effect.fail(notImplemented()))
			.handle("create", () => Effect.fail(notImplemented())),
);
