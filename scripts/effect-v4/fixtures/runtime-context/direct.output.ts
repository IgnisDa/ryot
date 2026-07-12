import { Context, Effect } from "effect";

interface Service {
	readonly value: string;
}

declare const effect: Effect.Effect<void, never, Service>;
declare const runtime: Context.Context<Service>;

type ExistingContext = Context.Context<Service>;
type Captured = Context.Context<Service>;
type Empty = Context.Context<never>;

const captures = Effect.gen(function* () {
	const runtime = yield* Effect.context();
	const typedRuntime = yield* Effect.context<Service>();
	return { runtime, typedRuntime };
});

const runPromise = Effect.runPromiseWith(runtime);
const promise = runPromise(effect);
const exit = Effect.runPromiseExitWith(runtime)(effect);
const fiber = Effect.runForkWith(runtime)(effect);
const holder = { runtime, nested: { runtime } };

void [captures, promise, exit, fiber, holder];
void (0 as unknown as ExistingContext | Captured | Empty);
