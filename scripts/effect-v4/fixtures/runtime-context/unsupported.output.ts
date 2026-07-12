import { Effect, Runtime } from "effect";

declare const runtime: unknown;

const capture = Effect.runtime();
const runPromise = Runtime["runPromise"](runtime);

void [capture, runPromise];
