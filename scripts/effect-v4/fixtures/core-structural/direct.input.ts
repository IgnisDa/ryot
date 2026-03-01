import { Effect, Fiber } from "effect";

declare const effect: Effect.Effect<string, unknown>;
declare const fiber: { interruptUnsafe(): void };
declare const message: string;

type State = {
	readonly semaphore: Effect.Semaphore;
};

const generated = Effect.gen(function* () {
	const semaphore = yield* Effect.makeSemaphore(1);
	yield* Fiber.interruptFork(fiber);
	return yield* Effect.dieMessage(message);
});

const returned = () => {
	return Effect.dieMessage("returned");
};
const ignored = effect.pipe(Effect.ignoreLogged);
const timeoutValue = effect.pipe(
	Effect.timeoutFail({
		// Keep duration first.
		duration: 1_000,
		// Keep timeout fallback comments.
		onTimeout: () => "timed out",
	}),
);
const timeoutError = effect.pipe(
	Effect.timeoutFail({
		duration: 2_000,
		onTimeout: () => new Error("timeout error"),
	}),
);
const fallback = effect.pipe(Effect.orElse(() => Effect.succeed("fallback")));
const optional = Effect.optionFromOptional(effect);
const restored = effect.pipe(Effect.unsandbox);

void [generated, returned, ignored, timeoutValue, timeoutError, fallback, optional, restored];
void (0 as unknown as State);
