import { assert, expect } from "@effect/vitest";
import { Cause, Exit, Option } from "effect";

export const assertExitFails = <A, E extends { readonly message: string }>(
	exit: Exit.Exit<A, E>,
	expected: E,
) => {
	assert(Exit.isFailure(exit));
	// TODO: on the Effect v4 upgrade, swap `Cause.failureOption` for `Cause.findErrorOption`;
	// the message check itself stays needed, since `message` remains non-enumerable in v4.
	const failure = Cause.failureOption(exit.cause);
	assert(Option.isSome(failure));
	expect(failure.value).toEqual(expected);
	expect(failure.value.message).toBe(expected.message);
};
