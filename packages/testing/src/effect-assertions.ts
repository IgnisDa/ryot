import { expect } from "bun:test";

import { Cause, Effect, Exit, Option, Schema } from "effect";

import { assert } from "./assert.js";

class PromiseRejection extends Schema.TaggedError<
	PromiseRejection,
	{ readonly brand: unique symbol }
>()("PromiseRejection", { reason: Schema.Unknown }) {}

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

export const promiseRejection = (evaluate: () => PromiseLike<unknown>) =>
	Effect.tryPromise({ try: evaluate, catch: (reason) => new PromiseRejection({ reason }) }).pipe(
		Effect.flip,
		Effect.map(({ reason }) => reason),
	);
