import { Deferred, Effect } from "effect";

import type { ServerOrigin } from "#/api/origin";

export const makeOriginSingleFlight = <A, E>() => {
	const pending = new Map<ServerOrigin, Deferred.Deferred<A, E>>();
	return (origin: ServerOrigin, compute: Effect.Effect<A, E>) =>
		Effect.gen(function* () {
			const existing = pending.get(origin);
			if (existing) {
				return yield* Deferred.await(existing);
			}
			const deferred = yield* Effect.uninterruptible(
				Effect.gen(function* () {
					const created = yield* Deferred.make<A, E>();
					pending.set(origin, created);
					yield* Effect.forkDetach(
						Deferred.into(
							compute.pipe(Effect.ensuring(Effect.sync(() => pending.delete(origin)))),
							created,
						),
						{ startImmediately: true },
					);
					return created;
				}),
			);
			return yield* Deferred.await(deferred);
		});
};
