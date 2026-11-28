import { Message } from "@ryot-app/i18n/message";
import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";

/** Why a change's policies refused it: a rejection, a transform the change cannot take, or a failed policy. */
export const PolicyFailureReason = Schema.Union([
	strictStruct({ message: Message, code: Schema.Literal("policy-rejected") }),
	strictStruct({
		code: Schema.Literal("invalid-properties"),
		paths: Schema.Array(Schema.Array(Schema.String)),
	}),
	strictStruct({ code: Schema.Literal("invalid-policy-transform") }),
	strictStruct({ code: Schema.Literal("policy-execution-failed") }),
]);
export type PolicyFailureReason = typeof PolicyFailureReason.Type;

/** A change's policies refused it; the same request is refused again. */
export class PolicyRejected extends Schema.TaggedError<
	PolicyRejected,
	{ readonly brand: unique symbol }
>()("PolicyRejected", { reason: PolicyFailureReason }) {}

/** A policy the change needs could not run for now; the same request may succeed later. */
export class PolicyUnavailable extends Schema.TaggedError<
	PolicyUnavailable,
	{ readonly brand: unique symbol }
>()("PolicyUnavailable", {
	reason: strictStruct({ code: Schema.Literal("policy-unavailable") }),
}) {}

/** A change's policies refused it or could not run. */
export const PolicyFailure = Schema.Union([PolicyRejected, PolicyUnavailable]);
export type PolicyFailure = typeof PolicyFailure.Type;
