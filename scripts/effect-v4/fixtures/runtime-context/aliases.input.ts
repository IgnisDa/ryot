import { Context as Ctx, Effect as Fx, Runtime as Rt } from "effect";

interface Service {
	readonly value: string;
}

declare const effect: Fx.Effect<void, never, Service>;
declare const runtime: Rt.Runtime<Service>;

type Captured = Rt.Runtime<Service>;

const capture = Fx.runtime<Service>();
const promise = Rt.runPromise(runtime)(effect);
const exit = Rt.runPromiseExit(runtime)(effect);
const fiber = Rt.runFork(runtime)(effect);

void [capture, promise, exit, fiber];
void (0 as unknown as Ctx.Context<Service> | Captured);
