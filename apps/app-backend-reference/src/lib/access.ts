import { Effect } from "effect";

export type AccessRule<T, E> = {
	readonly error: () => E;
	readonly test: (scope: T) => boolean;
};

export const requireAccess =
	<T, E>(input: { readonly notFound: () => E; readonly rules?: readonly AccessRule<T, E>[] }) =>
	(scope: T | null | undefined): Effect.Effect<T, E> =>
		Effect.gen(function* () {
			if (!scope) {
				return yield* Effect.fail(input.notFound());
			}

			for (const rule of input.rules ?? []) {
				if (!rule.test(scope)) {
					return yield* Effect.fail(rule.error());
				}
			}

			return scope;
		});

export const requireReadAccess =
	<E>(notFound: () => E) =>
	<T>(scope: T | null | undefined): Effect.Effect<T, E> =>
		requireAccess<T, E>({ notFound })(scope);

export const requireCustomAccess =
	<NotFoundError, BuiltinError>(errors: {
		readonly builtin: () => BuiltinError;
		readonly notFound: () => NotFoundError;
	}) =>
	<T extends { readonly isBuiltin: boolean }>(
		scope: T | null | undefined,
	): Effect.Effect<T, BuiltinError | NotFoundError> =>
		requireAccess<T, BuiltinError | NotFoundError>({
			notFound: errors.notFound,
			rules: [
				{
					error: errors.builtin,
					test: (candidate) => !candidate.isBuiltin,
				},
			],
		})(scope);
