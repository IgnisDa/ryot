import { Effect } from "effect";
export default (_input, host) =>
	Effect.runPromise(
		Effect.gen(function* () {
			let acc = 0;
			for (let i = 0; i < 5; i++) {
				const r = yield* Effect.promise(() => host.call("getUserPreferences", { i }));
				acc += r.n;
			}
			return { acc };
		}),
	);
