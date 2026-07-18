import { Effect, type Context } from "effect";

declare const effect: Effect.Effect<void>;
declare const runtime: Context.Context<never>;

// Keep capture comment.
const capture = Effect.context<never>();
const hostTemplate = `capture: ${Effect.context()}`;
const rawTemplate = String.raw`Effect.runtime(); Runtime.runPromise(runtime);`;

// Keep runner comment.
const promise = Effect.runPromiseWith(runtime)(effect);

void [capture, hostTemplate, rawTemplate, promise];
