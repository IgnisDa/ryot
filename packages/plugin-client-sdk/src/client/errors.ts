import { CommitConflictCode } from "@ryot-app/contract/modules/changes/change-set";
import { Message } from "@ryot-app/i18n/message";
import { RyotClientErrorReason } from "@ryot-app/plugin-client-contract";
import { Schema } from "effect";

export class RyotClientError extends Schema.TaggedError<
	RyotClientError,
	{ readonly brand: unique symbol }
>()("RyotClientError", {
	reason: RyotClientErrorReason,
	rejection: Schema.optionalKey(Message),
	conflict: Schema.optionalKey(CommitConflictCode),
}) {}

export const asTransportError = (error: unknown) =>
	error instanceof RyotClientError ? error : new RyotClientError({ reason: "transport" });

export const isEntitlementRequired = (error: unknown) =>
	error instanceof RyotClientError && error.reason === "entitlement-required";
