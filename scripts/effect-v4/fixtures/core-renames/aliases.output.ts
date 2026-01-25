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
	Fx.catch,
	FailureCause.findErrorOption,
	Outcome.hasInterrupts,
	ServiceContext.makeUnsafe,
	Lifetime.provide,
	Layers.effect,
	CoreEffect.andThen,
	Clock.makeUnsafe,
	Completion.doneUnsafe,
	Maybe.fromNullishOr,
];
type FacadeServices = Layers.Services<unknown>;
type ModuleServices = LayerTypes.Services<unknown>;
type FacadeSuccess = Fx.Success<unknown>;
type TypeOnlyError = EffectTypes.Error<unknown>;

void aliases;
