import { assert, expect } from "@effect/vitest";
import { Cause, Exit, Option } from "effect";

export const assertExitFails = <A, E extends { readonly message: string }>(
	exit: Exit.Exit<A, E>,
	expected: E,
) => {
	assert(Exit.isFailure(exit));
	const failure = Cause.findErrorOption(exit.cause);
	assert(Option.isSome(failure));
	expect(failure.value).toEqual(expected);
	expect(failure.value.message).toBe(expected.message);
};
