import { Data, Duration, Effect, Schedule } from "effect";

class PollIncomplete {
	readonly _tag = "PollIncomplete";
}

export class PollTimeout extends Data.TaggedError("PollTimeout")<{ readonly message: string }> {}

export const pollUntil = <A, E, R>(label: string, check: Effect.Effect<A | null, E, R>) => {
	const intervalMs = 500;
	const timeoutMs = 180_000;
	return check.pipe(
		Effect.flatMap((result) =>
			result === null ? Effect.fail(new PollIncomplete()) : Effect.succeed(result),
		),
		Effect.retry({
			while: (error) => error instanceof PollIncomplete,
			schedule: Schedule.spaced(Duration.millis(intervalMs)),
		}),
		Effect.catch((error) =>
			error instanceof PollIncomplete ? Effect.die(error) : Effect.fail(error),
		),
		Effect.timeoutOrElse({
			duration: Duration.millis(timeoutMs),
			orElse: () =>
				Effect.fail(
					new PollTimeout({ message: `'${label}' did not complete within ${timeoutMs}ms` }),
				),
		}),
	);
};
