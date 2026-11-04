import { expect } from "bun:test";

import { Cause, Exit, Option } from "effect";

import { assert } from "./assert.js";

export const assertExitFails = <A, E extends { readonly message: string }>(
	exit: Exit.Exit<A, E>,
	expected: E,
) => {
	assert(Exit.isFailure(exit));
	const failure = Cause.findErrorOption(exit.cause);
	assert(Option.isSome(failure));
	expect({ ...failure.value, message: failure.value.message }).toEqual({
		...expected,
		message: expected.message,
	});
	if (failure.value instanceof Error && expected instanceof Error) {
		expect(failure.value.name).toBe(expected.name);
	}
};
