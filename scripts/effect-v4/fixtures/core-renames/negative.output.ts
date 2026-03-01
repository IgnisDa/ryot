import { DateTime, Deferred, Effect, Layer, Option, Schema, Stream } from "effect";

const task = Effect.succeed(1);
const interpolated = `raw Effect.catchAll; host ${Effect.catch(task, () => Effect.succeed(0))}`;
// Keep raw DateTime.unsafeNow() references unchanged.
const embeddedNow = `raw DateTime.unsafeNow(); host ${DateTime.nowUnsafe()}`;
const stringSource = "Cause.failureOption; Layer.Layer.Context; DateTime.unsafeNow()";
const templateSource = `Layer.scoped; Effect.fork; DateTime.unsafeNow()`;
const fromNullable = (value: unknown) => value;
const ordinary = { catchAll: "ordinary", scoped: "ordinary" };
const unrelated = [
	ordinary.catchAll,
	ordinary.scoped,
	fromNullable(null),
	Stream.as,
	DateTime.unsafeMakeZoned,
	Deferred.unsafeMake,
	Option.fromUndefinedOr,
];
const shadowed = (
	DateTime: { unsafeNow: () => unknown },
	Effect: { catchAll: string },
	Layer: { scoped: string },
) => [DateTime.unsafeNow(), Effect.catchAll, Layer.scoped];
const lexicallyShadowedExtractor = (Effect: unknown) => {
	type Success = Effect.Effect.Success<unknown>;
	return undefined as unknown as Success;
};
type Shadowed<Layer extends { Layer: { Context: unknown } }> = Layer.Layer.Context;
type ShadowedExtractor<Effect> = Effect.Effect.Success<unknown>;
type EffectBase = Effect.Effect<string, Error, never>;
type SchemaNested = Schema.Schema.Type<unknown>;

void [
	embeddedNow,
	interpolated,
	stringSource,
	templateSource,
	unrelated,
	shadowed,
	lexicallyShadowedExtractor,
];
