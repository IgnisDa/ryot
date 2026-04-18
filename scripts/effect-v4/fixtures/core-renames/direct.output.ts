import { Cause, Context, DateTime, Deferred, Effect, Exit, Layer, Option, Scope } from "effect";

declare const date: Date;
declare const deferred: Deferred.Deferred<void>;
declare const layer: Layer.Layer<never>;
declare const nullable: string | null;

const optional = Option.fromNullishOr(nullable);
const fromNullable = Option.fromNullishOr;
const now: DateTime.DateTime = DateTime.nowUnsafe(); // preserve target comments
Deferred.doneUnsafe(deferred, Effect.void);

const renamed = [
	Effect.catch,
	Effect.catchCause,
	Effect.andThen,
	Effect.forkChild,
	Effect.tapCause,
	Cause.findErrorOption,
	Cause.hasInterrupts,
	Cause.hasInterruptsOnly,
	Exit.hasInterrupts,
	Context.makeUnsafe,
	Scope.provide,
	Layer.effectDiscard,
	Layer.unwrap,
	Layer.effect,
	DateTime.isLessThan(now, DateTime.makeUnsafe(0)),
	DateTime.fromDateUnsafe(date),
];
type Services = Layer.Services<typeof layer>;
type Failure = Effect./* preserve extractor qualifier */ Error<
	Effect.Effect<never, Error>
>;
type Success = Effect.Success<
	/* preserve extractor arguments */
	Effect.Effect<string>
>;
type EffectBase = Effect.Effect<string, Error, never>;

void [renamed, optional, fromNullable];
