import { Effect, Runtime } from "effect";

declare const effect: Effect.Effect<void>;
declare const runtime: Runtime.Runtime<never>;

// Keep capture comment.
const capture = Effect.runtime<never>();
const hostTemplate = `capture: ${Effect.runtime()}`;
const rawTemplate = String.raw`Effect.runtime(); Runtime.runPromise(runtime);`;

// Keep runner comment.
const promise = Runtime.runPromise(runtime)(effect);

void [capture, hostTemplate, rawTemplate, promise];
