import { Message } from "@ryot-app/i18n/message";
import { RyotClientErrorReason } from "@ryot-app/plugin-client-contract";
import { Schema } from "effect";

export class RyotClientError extends Schema.TaggedError<
	RyotClientError,
	{ readonly brand: unique symbol }
>()("RyotClientError", { reason: RyotClientErrorReason, rejection: Schema.optionalKey(Message) }) {}

export const asTransportError = (error: unknown) =>
	error instanceof RyotClientError ? error : new RyotClientError({ reason: "transport" });

export const isEntitlementRequired = (error: unknown) =>
	error instanceof RyotClientError && error.reason === "entitlement-required";
