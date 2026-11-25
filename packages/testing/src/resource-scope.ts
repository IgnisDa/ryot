import { Effect, Exit, Scope } from "effect";

export const acquireInChildScope = <A, E, R>(self: Effect.Effect<A, E, R>) =>
	Effect.uninterruptibleMask((restore) =>
		Effect.gen(function* () {
			const parent = yield* Scope.Scope;
			const child = yield* Scope.fork(parent);
			return yield* Scope.provide(restore(self), child).pipe(
				Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(child, exit) : Effect.void)),
			);
		}),
	);

export const makeTestResourceScope = () => {
	const scope = Scope.makeUnsafe();
	return {
		close: Scope.close(scope, Exit.void),
		run: <A, E, R>(self: Effect.Effect<A, E, R>) =>
			Scope.provide(self, scope).pipe(
				Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
			),
	};
};
