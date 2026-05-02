import { Schema, SchemaGetter } from "effect";
import { Multipart } from "effect/unstable/http";
import { HttpApiSchema } from "effect/unstable/httpapi";

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
export const MultipartParseErrorSchema = multipartErrorSchema(["Parse"], 400);
export const MultipartInternalErrorSchema = multipartErrorSchema(["InternalError"], 500);
