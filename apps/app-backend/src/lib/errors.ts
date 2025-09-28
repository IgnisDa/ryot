import { Schema } from "effect";

export class DbError extends Schema.TaggedError<DbError>()("DbError", {
	message: Schema.String,
	code: Schema.optional(Schema.String),
	table: Schema.optional(Schema.String),
	column: Schema.optional(Schema.String),
	constraint: Schema.optional(Schema.String),
}) {}

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

export class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
	message: Schema.String,
}) {}

export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", {
	message: Schema.String,
}) {}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
	message: Schema.String,
}) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
	message: Schema.String,
}) {}

export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
	message: Schema.String,
}) {}

export class InternalError extends Schema.TaggedError<InternalError>()("InternalError", {
	message: Schema.String,
}) {}

// TODO: Temporary marker error returned from all skeleton route handlers.
// Remove module by module as behavior is migrated.
export class NotImplemented extends Schema.TaggedError<NotImplemented>()("NotImplemented", {
	message: Schema.String,
}) {}

export const badRequest = (message: string) => new BadRequest({ message });
export const conflict = (message: string) => new Conflict({ message });
export const notFound = (message: string) => new NotFound({ message });
export const unauthorized = () => new Unauthorized({ message: "Unauthorized" });
export const rateLimited = (message: string) => new RateLimited({ message });
export const internalError = (message: string) => new InternalError({ message });
export const notImplemented = () => new NotImplemented({ message: "Not implemented" });
