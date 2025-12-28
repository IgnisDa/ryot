import { HttpApiMiddleware, HttpServerRequest, Multipart } from "@effect/platform";
import { Effect, Layer, Stream } from "effect";

import { TEMPORARY_UPLOAD_MAX_REQUEST_BYTES } from "./shared";

export class UploadBodyLimitMiddleware extends HttpApiMiddleware.Tag<UploadBodyLimitMiddleware>()(
	"UploadBodyLimitMiddleware",
	{ failure: Multipart.MultipartError },
) {}

export const UploadBodyLimitMiddlewareLive = Layer.effect(
	UploadBodyLimitMiddleware,
	Effect.succeed(
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			const hasTransferEncoding = Boolean(request.headers["transfer-encoding"]);
			const contentLengthHeader = request.headers["content-length"];
			const contentLength = contentLengthHeader
				? Number.parseInt(contentLengthHeader, 10)
				: Number.NaN;

			if (
				!hasTransferEncoding &&
				Number.isFinite(contentLength) &&
				contentLength > TEMPORARY_UPLOAD_MAX_REQUEST_BYTES
			) {
				// TODO: https://github.com/Effect-TS/effect/issues/6284
				// The correct fix is upstream in @effect/platform-bun: exceeding
				// `maxTotalSize` while persisting multipart files should fail with a
				// prompt MultipartError instead of hanging the active file reader.
				// Once that lands, remove this content-length precheck and rely only on
				// the HttpApiSchema.Multipart size limits declared in contract.ts.
				yield* Stream.runDrain(request.stream).pipe(Effect.catchAll(() => Effect.void));

				return yield* new Multipart.MultipartError({
					reason: "BodyTooLarge",
					cause: { _tag: "ReachedLimit", limit: "MaxTotalSize" },
				});
			}

			return yield* Effect.void;
		}),
	),
);
