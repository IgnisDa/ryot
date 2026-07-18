import {
	Cause as FailureCause,
	Context as ServiceContext,
	DateTime as Clock,
	Deferred as Completion,
	Effect as Fx,
	Exit as Outcome,
	Layer as Layers,
	Option as Maybe,
	Scope as Lifetime,
} from "@ryot/sandbox-sdk/effect";
import { Effect as CoreEffect, type Effect as EffectTypes } from "effect";
import type * as LayerTypes from "effect/Layer";

const aliases = [
	Fx.catchAll,
	FailureCause.failureOption,
	Outcome.isInterrupted,
	ServiceContext.unsafeMake,
	Lifetime.extend,
	Layers.scoped,
	CoreEffect.zipRight,
	Clock.unsafeMake,
	Completion.unsafeDone,
	Maybe.fromNullable,
];
type FacadeServices = Layers.Layer.Context<unknown>;
type ModuleServices = LayerTypes.Layer.Context<unknown>;
type FacadeSuccess = Fx.Effect.Success<unknown>;
type TypeOnlyError = EffectTypes.Effect.Error<unknown>;

void aliases;
