import { RyotClientErrorReason } from "@ryot-app/plugin-client-contract";
import { Schema } from "effect";

export class RyotClientError extends Schema.TaggedError<
	RyotClientError,
	{ readonly brand: unique symbol }
>()("RyotClientError", {
	reason: RyotClientErrorReason,
	message: Schema.optionalKey(Schema.String),
}) {}

export const asTransportError = (error: unknown) =>
	error instanceof RyotClientError ? error : new RyotClientError({ reason: "transport" });
