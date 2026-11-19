import { Clock, Duration, Effect } from "effect";

export const waitForImpersonationExpiry = Effect.fnUntraced(function* (
	expiresAt: number,
	awaitResume: () => Effect.Effect<void>,
) {
	const wait: () => Effect.Effect<void> = () =>
		Effect.gen(function* () {
			const remaining = expiresAt - (yield* Clock.currentTimeMillis);
			if (remaining <= 0) {
				return;
			}
			yield* Effect.raceFirst(Effect.sleep(Duration.millis(remaining)), awaitResume());
			yield* wait();
		});
	return yield* wait();
});

export const awaitDocumentVisible = Effect.fnUntraced(function* () {
	yield* Effect.callback<void>((resume) => {
		const onVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				resume(Effect.void);
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);
		return Effect.sync(() => document.removeEventListener("visibilitychange", onVisibilityChange));
	});
});
