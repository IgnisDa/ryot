import { Context, Effect, Runtime } from "effect";

interface Service {
	readonly value: string;
}

declare const effect: Effect.Effect<void, never, Service>;
declare const runtime: Runtime.Runtime<Service>;

type ExistingContext = Context.Context<Service>;
type Captured = Runtime.Runtime<Service>;
type Empty = Runtime.Runtime<never>;

const captures = Effect.gen(function* () {
	const runtime = yield* Effect.runtime();
	const typedRuntime = yield* Effect.runtime<Service>();
	return { runtime, typedRuntime };
});

const runPromise = Runtime.runPromise(runtime);
const promise = runPromise(effect);
const exit = Runtime.runPromiseExit(runtime)(effect);
const fiber = Runtime.runFork(runtime)(effect);
const holder = { runtime, nested: { runtime } };

void [captures, promise, exit, fiber, holder];
void (0 as unknown as ExistingContext | Captured | Empty);
