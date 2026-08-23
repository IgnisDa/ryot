import { Deferred, Effect } from "effect";

import { normalizeServerOrigin, type ServerOrigin } from "#/api/origin";

export const makeOriginSingleFlight = <A, E>() => {
	const pending = new Map<ServerOrigin, Deferred.Deferred<A, E>>();
	return (origin: ServerOrigin, compute: Effect.Effect<A, E>) =>
		Effect.gen(function* () {
			const canonical = normalizeServerOrigin(origin);
			const existing = pending.get(canonical);
			if (existing) {
				return yield* Deferred.await(existing);
			}
			const deferred = yield* Effect.uninterruptible(
				Effect.gen(function* () {
					const created = yield* Deferred.make<A, E>();
					pending.set(canonical, created);
					yield* Effect.forkDetach(
						Deferred.into(
							compute.pipe(Effect.ensuring(Effect.sync(() => pending.delete(canonical)))),
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
