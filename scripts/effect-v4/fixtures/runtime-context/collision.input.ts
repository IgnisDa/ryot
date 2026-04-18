import { Runtime } from "effect";

type Context = { readonly local: true };
declare const Effect: { readonly local: true };

interface Service {
	readonly value: string;
}

declare const effect: unknown;
declare const runtime: Runtime.Runtime<Service>;

const promise = Runtime.runPromise(runtime)(effect);

void [Effect, promise];
void (0 as unknown as Context);
