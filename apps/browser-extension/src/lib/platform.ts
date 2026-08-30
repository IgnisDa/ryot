import { Data, Effect } from "effect";

export class ExtensionError extends Data.TaggedError("ExtensionError")<{ cause: unknown }> {}

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
