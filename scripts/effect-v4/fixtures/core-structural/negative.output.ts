import { Config, Context, Effect, Fiber, Layer, Match, Runtime, Stream, Tracer } from "effect";

const stringSource =
	"Effect.dieMessage('raw'); Effect.mapInputContext(effect, (context) => context); Stream.as(PING); context.unsafeMap;";
const templateSource = `context.unsafeMap; Effect.mapInputContext(effect, (context) => context); Effect.timeoutFail({ duration: 1, onTimeout: () => "raw" }); Stream.as(PING);`;
const ordinary = {
	as: (value: unknown) => value,
	dieMessage: () => "ordinary",
	mapInputContext: (effect: unknown) => effect,
	orElse: () => "ordinary",
	unsafeMap: new Map(),
};
const unrelated = [
	ordinary.as("ordinary"),
	ordinary.dieMessage(),
	ordinary.mapInputContext(ordinary),
	ordinary["orElse"](),
	ordinary?.orElse(),
	ordinary.unsafeMap,
];
const retained = [
	Effect.as,
	Effect.orElseSucceed,
	Match.orElse,
	Config.orElse,
	Effect.async,
	Stream.asyncPush,
	Stream.map,
	Layer.effect,
	Runtime.runFork,
	Tracer.make,
];
const shadowed = (
	Effect: {
		dieMessage: (message: string) => string;
		mapInputContext: (effect: unknown, map: (context: unknown) => unknown) => unknown;
		makeSemaphore: (permits: number) => number;
	},
	Fiber: { interruptFork: (fiber: unknown) => void },
	fiber: unknown,
	) => [
		Effect.dieMessage("shadowed"),
		Effect.mapInputContext(fiber, (context) => context),
		Effect.makeSemaphore(1),
		Fiber.interruptFork(fiber),
	];
const shadowedStream = (
	Stream: { as: (value: unknown) => unknown },
	source: { pipe: (...operations: unknown[]) => unknown },
	value: unknown,
) => source.pipe(Stream.as(value));
const shadowedContext = (context: Context.Context<never>) => {
	const read = (context: { unsafeMap: ReadonlyMap<string, unknown> }) => context.unsafeMap;
	return read({ unsafeMap: new Map() });
};

void [
	stringSource,
	templateSource,
	unrelated,
	retained,
	shadowed,
	shadowedStream,
	shadowedContext,
];
