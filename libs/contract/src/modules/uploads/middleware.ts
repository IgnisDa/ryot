import { Effect, Layer, Schema, SchemaGetter, Stream } from "effect";
import { HttpServerRequest, Multipart } from "effect/unstable/http";
import { HttpApiMiddleware, HttpApiSchema } from "effect/unstable/httpapi";

import { TEMPORARY_UPLOAD_MAX_REQUEST_BYTES } from "./upload-policy";

type MultipartErrorReason = Multipart.MultipartErrorReason["_tag"];

const multipartErrorSchema = <const Reasons extends ReadonlyArray<MultipartErrorReason>>(
	reasons: Reasons,
	status: number,
) => {
	const Reason = Schema.Literals(reasons);
	const Runtime = Schema.declare(
		(value): value is Multipart.MultipartError =>
			value instanceof Multipart.MultipartError && reasons.includes(value.reason._tag),
	);
	const Wire = Schema.Struct({
		_tag: Schema.Literal("MultipartError"),
		reason: Reason,
		// Matches old wire behavior: JSON-safe causes survive; unsupported unknown values remain serializer errors.
		cause: Schema.optional(Schema.Unknown),
	});

	return Wire.pipe(
		Schema.decodeTo(Runtime, {
			decode: SchemaGetter.transform(({ cause, reason }) =>
				Multipart.MultipartError.fromReason(reason, cause),
			),
			encode: SchemaGetter.transform((error) => ({
				_tag: "MultipartError",
				reason: Schema.decodeUnknownSync(Reason)(error.reason._tag),
				...(error.reason.cause === undefined ? {} : { cause: error.reason.cause }),
			})),
		}),
		HttpApiSchema.status(status),
	);
};

export const MultipartLimitErrorSchema = multipartErrorSchema(
	["FileTooLarge", "FieldTooLarge", "BodyTooLarge", "TooManyParts"],
	413,
);
const MultipartBodyTooLargeErrorSchema = multipartErrorSchema(["BodyTooLarge"], 413);
export const MultipartParseErrorSchema = multipartErrorSchema(["Parse"], 400);
export const MultipartInternalErrorSchema = multipartErrorSchema(["InternalError"], 500);

export class UploadBodyLimitMiddleware extends HttpApiMiddleware.Service<UploadBodyLimitMiddleware>()(
	"UploadBodyLimitMiddleware",
	{ error: MultipartBodyTooLargeErrorSchema },
) {}

export const UploadBodyLimitMiddlewareLive = Layer.effect(
	UploadBodyLimitMiddleware,
	Effect.succeed((httpEffect) =>
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
				yield* Stream.runDrain(request.stream).pipe(Effect.catch(() => Effect.void));

				return yield* Multipart.MultipartError.fromReason("BodyTooLarge", {
					_tag: "ReachedLimit",
					limit: "MaxTotalSize",
				});
			}

			return yield* httpEffect;
		}),
	),
);
