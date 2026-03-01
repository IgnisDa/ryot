import { Cause, Context, DateTime, Deferred, Effect, Exit, Layer, Option, Scope } from "effect";

declare const date: Date;
declare const deferred: Deferred.Deferred<void>;
declare const layer: Layer.Layer<never>;
declare const nullable: string | null;

const optional = Option.fromNullable(nullable);
const fromNullable = Option.fromNullable;
const now: DateTime.DateTime = DateTime.unsafeNow(); // preserve target comments
Deferred.unsafeDone(deferred, Effect.void);

const renamed = [
	Effect.catchAll,
	Effect.catchAllCause,
	Effect.zipRight,
	Effect.fork,
	Effect.tapErrorCause,
	Cause.failureOption,
	Cause.isInterrupted,
	Cause.isInterruptedOnly,
	Exit.isInterrupted,
	Context.unsafeMake,
	Scope.extend,
	Layer.scopedDiscard,
	Layer.unwrapEffect,
	Layer.scoped,
	DateTime.lessThan(now, DateTime.unsafeMake(0)),
	DateTime.unsafeFromDate(date),
];
type Services = Layer.Layer.Context<typeof layer>;
type Failure = Effect./* preserve extractor qualifier */ Effect.Error<
	Effect.Effect<never, Error>
>;
type Success = Effect.Effect.Success<
	/* preserve extractor arguments */
	Effect.Effect<string>
>;
type EffectBase = Effect.Effect<string, Error, never>;

void [renamed, optional, fromNullable];
