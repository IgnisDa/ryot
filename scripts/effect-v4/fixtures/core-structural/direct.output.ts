import { Effect, Semaphore } from "effect";

declare const effect: Effect.Effect<string, unknown>;
declare const fiber: { interruptUnsafe(): void };
declare const message: string;

type State = {
	readonly semaphore: Semaphore.Semaphore;
};

const generated = Effect.gen(function* () {
	const semaphore = yield* Semaphore.make(1);
	fiber.interruptUnsafe();
	return yield* Effect.die(new Error(message));
});

const returned = () => {
	return Effect.die(new Error("returned"));
};
const ignored = effect.pipe(Effect.ignore({
    log: true
}));
const timeoutValue = effect.pipe(
	Effect.timeoutOrElse({
		// Keep duration first.
		duration: 1_000,
		// Keep timeout fallback comments.
		orElse: () => Effect.fail("timed out"),
	}),
);
const timeoutError = effect.pipe(
	Effect.timeoutOrElse({
		duration: 2_000,
		orElse: () => Effect.fail(new Error("timeout error")),
	}),
);
const fallback = effect.pipe(Effect.catch(() => Effect.succeed("fallback")));
const optional = Effect.catchNoSuchElement(effect);
const restored = effect.pipe(Effect.catch(cause => Effect.failCause(cause)));

void [generated, returned, ignored, timeoutValue, timeoutError, fallback, optional, restored];
void (0 as unknown as State);
