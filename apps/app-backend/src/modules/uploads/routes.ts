import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { UploadsService } from "./service";

export const UploadsRoutesLive = HttpApiBuilder.group(AppContract, "uploads", (handlers) =>
	handlers
		.handle("createIntent", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.createUploadIntent(user, payload).pipe(dieOnDbError);
			}),
		)
		.handle("completeIntent", ({ params }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* UploadsService;
				return yield* service.completeUploadIntent(user, params.intentId).pipe(dieOnDbError);
			}),
		)
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

export const LocalUploadsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"localUploads",
	(handlers) =>
		handlers.handle("put", ({ params, request }) =>
			Effect.gen(function* () {
				const service = yield* UploadsService;
				yield* service.putLocalIntent(
					params.intentId,
					request.method,
					request.url,
					request.headers["content-type"],
					request.headers["content-length"],
					request.stream,
				);
				return void 0;
			}),
		),
);
