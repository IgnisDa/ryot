import { Deferred, Effect } from "effect";

export const makeSingleFlight = <A, E>() => {
	let pending: Deferred.Deferred<A, E> | undefined;
	return Effect.fnUntraced(function* (compute: Effect.Effect<A, E>) {
		const deferred = yield* Effect.uninterruptible(
			Effect.gen(function* () {
				if (pending) {
					return pending;
				}
				const created = yield* Deferred.make<A, E>();
				pending = created;
				yield* Effect.forkDetach(
					Deferred.into(
						compute.pipe(
							Effect.ensuring(
								Effect.sync(() => {
									pending = undefined;
								}),
							),
						),
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
