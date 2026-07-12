import { Context as Ctx, Effect as Fx } from "effect";

interface Service {
	readonly value: string;
}

declare const effect: Fx.Effect<void, never, Service>;
declare const runtime: Ctx.Context<Service>;

type Captured = Ctx.Context<Service>;

const capture = Fx.context<Service>();
const promise = Fx.runPromiseWith(runtime)(effect);
const exit = Fx.runPromiseExitWith(runtime)(effect);
const fiber = Fx.runForkWith(runtime)(effect);

void [capture, promise, exit, fiber];
void (0 as unknown as Ctx.Context<Service> | Captured);
