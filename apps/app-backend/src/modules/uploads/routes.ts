import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { AppContract } from "../../lib/contract";
import { notImplemented } from "../../lib/errors";

export const UploadsRoutesLive = HttpApiBuilder.group(AppContract, "uploads", (handlers) =>
	handlers
		.handle("createPresigned", () => Effect.fail(notImplemented()))
		.handle("createPresignedDownload", () => Effect.fail(notImplemented()))
		.handle("uploadTemporary", () => Effect.fail(notImplemented())),
);
