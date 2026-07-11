import { Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

export type RyotQLResultState<Value> =
	| { readonly status: "loading" }
	| { readonly status: "ready"; readonly value: Value }
	| { readonly status: "malformed"; readonly cause: Cause.Cause<unknown> }
	| { readonly status: "transport-error"; readonly cause: Cause.Cause<unknown> };

export class RyotQLMalformedResultError extends Error {
	readonly _tag = "RyotQLMalformedResultError";

	constructor(readonly detail: unknown) {
		super("The RyotQL result was malformed");
	}
}

export const isRyotQLMalformedResultCause = (cause: Cause.Cause<unknown>) =>
	Option.exists(
		Cause.findErrorOption(cause),
		(error) => error instanceof RyotQLMalformedResultError,
	);

export const classifyRyotQLResult = <Value>(
	result: AsyncResult.AsyncResult<Value, unknown>,
): RyotQLResultState<Value> => {
	if (AsyncResult.isFailure(result)) {
		return {
			cause: result.cause,
			status: isRyotQLMalformedResultCause(result.cause) ? "malformed" : "transport-error",
		};
	}
	return AsyncResult.isSuccess(result)
		? { status: "ready", value: result.value }
		: { status: "loading" };
};
