import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { CurrentUser } from "#lib/auth";
import { AppContract } from "#lib/contract";

import { UploadsService } from "./service";

export const UploadsRoutesLive = HttpApiBuilder.group(AppContract, "uploads", (handlers) =>
	handlers
		.handle("createPresigned", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.createPresignedUpload(user, payload.contentType);
			}),
		)
		.handle("createPresignedDownload", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.createPresignedDownload(user, payload.keys);
			}),
		)
		.handle("uploadTemporary", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.uploadTemporary(user, payload["files[]"]);
			}),
		),
);
