import { Context, Effect } from "effect";

declare const context: Context.Context<never>;
declare const effect: Effect.Effect<void>;

const planned = Effect.mapInputContext(
	effect,
	(current: Context.Context<never>) => current,
);
const computed = context["unsafeMap"];
const optional = context?.unsafeMap;

void [planned, computed, optional];
