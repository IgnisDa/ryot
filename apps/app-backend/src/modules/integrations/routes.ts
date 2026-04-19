import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../lib/contract";
import { notImplemented } from "../../lib/errors";

export const IntegrationsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"integrations",
	(handlers) =>
		handlers
			.handle("list", () => Effect.fail(notImplemented()))
			.handle("create", () => Effect.fail(notImplemented()))
			.handle("get", () => Effect.fail(notImplemented()))
			.handle("update", () => Effect.fail(notImplemented()))
			.handle("delete", () => Effect.fail(notImplemented()))
			.handle("getRuns", () => Effect.fail(notImplemented()))
			.handle("webhook", () => Effect.fail(notImplemented())),
);
