import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";

import { UploadsService } from "./service";

export const UploadsRoutesLive = HttpApiBuilder.group(AppContract, "uploads", (handlers) =>
	handlers
		.handle("createPresigned", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.createPresignedUpload(user, payload.contentType).pipe(dieOnDbError);
			}),
		)
		.handle("createPresignedDownload", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.createPresignedDownload(user, payload.keys).pipe(dieOnDbError);
			}),
		)
		.handle("uploadTemporary", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.uploadTemporary(user, payload["files[]"]).pipe(dieOnDbError);
			}),
		),
);
