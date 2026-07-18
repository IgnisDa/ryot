import { Atom, Effect, FiberSet, HttpApi, Layer, ManagedRuntime, Runtime, Tracer } from "effect";
import { BunRuntime } from "@effect/platform-bun";

interface Service {
	readonly value: string;
}

declare const context: unknown;
declare const program: unknown;

const shadowedEffect = (Effect: { runtime: () => unknown }) => Effect.runtime();
const shadowedRuntime = (Runtime: { runPromise: (value: unknown) => unknown }) =>
	Runtime.runPromise(context);
const shadowedType = <Runtime>() => {
	type Captured = Runtime.Runtime<Service>;
	return undefined as unknown as Captured;
};

const runtime = { runtime: "local" };
const retained = [
	Layer.toRuntime,
	ManagedRuntime.make,
	BunRuntime.runMain,
	Atom.runtime,
	FiberSet.makeRuntime,
	HttpApi.make,
	Tracer.make,
	Runtime.makeRunMain,
	Effect.context,
];
const rawTemplate = String.raw`Effect.runtime(); Runtime.Runtime; Runtime.runFork(context);`;

void [shadowedEffect, shadowedRuntime, shadowedType, runtime.runtime, retained, rawTemplate, program];
