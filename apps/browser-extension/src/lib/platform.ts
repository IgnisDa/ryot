import { Effect, Schema } from "effect";

export class ExtensionError extends Schema.TaggedError<
	ExtensionError,
	{ readonly brand: unique symbol }
>()("ExtensionError", { cause: Schema.Unknown }) {}

export const fromPlatform = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new ExtensionError({ cause }) });

export const errorMessage = (error: unknown): string => {
	if (error instanceof ExtensionError) {
		return errorMessage(error.cause);
	}
	return error instanceof Error ? error.message : "Unknown error";
};

export const run = <A, E>(program: Effect.Effect<A, E>) => {
	void Effect.runPromise(program);
};
