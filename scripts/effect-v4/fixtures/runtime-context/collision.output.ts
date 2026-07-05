import { type Context as EffectContext, Effect as EffectRuntime } from "effect";

type Context = { readonly local: true };
declare const Effect: { readonly local: true };

interface Service {
	readonly value: string;
}

declare const effect: unknown;
declare const runtime: EffectContext.Context<Service>;

const promise = EffectRuntime.runPromiseWith(runtime)(effect);

void [Effect, promise];
void (0 as unknown as Context);
