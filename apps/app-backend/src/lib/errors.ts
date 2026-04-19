import { Schema } from "effect";

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
export const internalError = (message: string) => new InternalError({ message });
export const notImplemented = () => new NotImplemented({ message: "Not implemented" });
