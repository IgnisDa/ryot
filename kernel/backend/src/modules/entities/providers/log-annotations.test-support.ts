import { Context, Effect, Layer, Logger, References } from "effect";

type Annotations = Readonly<Record<string, unknown>>;

export class RecordedLogAnnotations extends Context.Service<
	RecordedLogAnnotations,
	{ readonly annotations: Effect.Effect<ReadonlyArray<Annotations>> }
>()("test/RecordedLogAnnotations") {}

export const recordLogAnnotationsLayer = (fragment: string) =>
	Layer.unwrap(
		Effect.sync(() => {
			// A logger reports synchronously, so the recording lives with the layer instead of in a Ref.
			const recorded: Annotations[] = [];
			const logger = Logger.make<unknown, void>((options) => {
				if (String(options.message).includes(fragment)) {
					recorded.push(options.fiber.getRef(References.CurrentLogAnnotations));
				}
			});
			return Layer.merge(
				Logger.layer([logger]),
				Layer.succeed(RecordedLogAnnotations, { annotations: Effect.sync(() => [...recorded]) }),
			);
		}),
	);
