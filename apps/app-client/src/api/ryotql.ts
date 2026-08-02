import { Cause, Option } from "effect";

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
