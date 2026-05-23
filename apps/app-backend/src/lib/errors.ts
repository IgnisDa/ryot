import { Schema } from "effect";

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {
	message: Schema.String,
}) {}

// TODO: Temporary marker error returned from all skeleton route handlers.
// Remove module by module as behavior is migrated.
export class NotImplemented extends Schema.TaggedError<NotImplemented>()("NotImplemented", {
	message: Schema.String,
}) {}

export const unauthorized = () => new Unauthorized({ message: "Unauthorized" });

export const notImplemented = () => new NotImplemented({ message: "Not implemented" });
