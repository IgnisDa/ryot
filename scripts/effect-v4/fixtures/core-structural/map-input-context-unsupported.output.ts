import { Context, Effect } from "effect";

declare const effect: Effect.Effect<void>;
declare const makeEffect: () => Effect.Effect<void>;

const supported = Effect.dieMessage("must remain unchanged");
const wrongArity = Effect.mapInputContext(effect);
const blockBody = Effect.mapInputContext(effect, (context: Context.Context<never>) => {
	return context;
});
const unstableEffect = Effect.mapInputContext(
	makeEffect(),
	(context: Context.Context<never>) => context,
);
const computed = Effect["mapInputContext"](
	effect,
	(context: Context.Context<never>) => context,
);

void [supported, wrongArity, blockBody, unstableEffect, computed];
