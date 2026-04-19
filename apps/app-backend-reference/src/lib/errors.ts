import { Schema } from "effect";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
	message: Schema.String,
}) {}

export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
	message: Schema.String,
}) {}

export class DbError extends Schema.TaggedError<DbError>()("DbError", {
	message: Schema.String,
	code: Schema.optional(Schema.String),
	table: Schema.optional(Schema.String),
	column: Schema.optional(Schema.String),
	constraint: Schema.optional(Schema.String),
}) {}

export class AudibleRunNotFound extends Schema.TaggedError<AudibleRunNotFound>()(
	"AudibleRunNotFound",
	{
		id: Schema.String,
	},
) {}

export class UploadNotFound extends Schema.TaggedError<UploadNotFound>()("UploadNotFound", {
	id: Schema.String,
}) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
	message: Schema.String,
}) {}

export class TimeoutError extends Schema.TaggedError<TimeoutError>()("TimeoutError", {
	message: Schema.String,
}) {}

export class SandboxRunError extends Schema.TaggedError<SandboxRunError>()("SandboxRunError", {
	message: Schema.String,
}) {}

export class AudibleRunError extends Schema.TaggedError<AudibleRunError>()("AudibleRunError", {
	message: Schema.String,
}) {}

export class PatternsRejected extends Schema.TaggedError<PatternsRejected>()("PatternsRejected", {
	runId: Schema.String,
	message: Schema.String,
}) {}

export class PatternsDuplicateItem extends Schema.TaggedError<PatternsDuplicateItem>()(
	"PatternsDuplicateItem",
	{
		query: Schema.String,
		message: Schema.String,
	},
) {}

type PgErrorLike = {
	readonly code?: unknown;
	readonly table?: unknown;
	readonly column?: unknown;
	readonly constraint?: unknown;
};

const pgStringField = (cause: unknown, field: keyof PgErrorLike) => {
	if (!cause || typeof cause !== "object") {
		return undefined;
	}

	const value = (cause as PgErrorLike)[field];
	return typeof value === "string" ? value : undefined;
};

export const unknownToMessage = (cause: unknown) =>
	cause instanceof Error ? cause.message : String(cause);

export const unknownToDbError = (cause: unknown) =>
	new DbError({
		message: unknownToMessage(cause),
		...(pgStringField(cause, "code") ? { code: pgStringField(cause, "code") } : {}),
		...(pgStringField(cause, "table") ? { table: pgStringField(cause, "table") } : {}),
		...(pgStringField(cause, "column") ? { column: pgStringField(cause, "column") } : {}),
		...(pgStringField(cause, "constraint")
			? { constraint: pgStringField(cause, "constraint") }
			: {}),
	});

export const unauthorized = () => new Unauthorized({ message: "Unauthorized" });

export const badRequest = (message: string) => new BadRequest({ message });

export const toAudibleRunError = (cause: unknown) =>
	new AudibleRunError({ message: unknownToMessage(cause) });
