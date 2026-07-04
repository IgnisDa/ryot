import { Data, Duration, Effect, Schedule } from "effect";

export interface PollOptions {
	timeoutMs?: number;
	intervalMs?: number;
}

class PollIncomplete {
	readonly _tag = "PollIncomplete";
}

export class PollTimeout extends Data.TaggedError("PollTimeout")<{ readonly message: string }> {}

export const pollUntil = <A, E, R>(
	label: string,
	check: Effect.Effect<A | null, E, R>,
	options: PollOptions = {},
) => {
	const { intervalMs = 500, timeoutMs = 60_000 } = options;
	return check.pipe(
		Effect.flatMap((result) =>
			result === null ? Effect.fail(new PollIncomplete()) : Effect.succeed(result),
		),
		Effect.retry({
			while: (error) => error instanceof PollIncomplete,
			schedule: Schedule.spaced(Duration.millis(intervalMs)),
		}),
		Effect.catchAll((error) =>
			error instanceof PollIncomplete ? Effect.die(error) : Effect.fail(error),
		),
		Effect.timeoutFail({
			duration: Duration.millis(timeoutMs),
			onTimeout: () =>
				new PollTimeout({ message: `'${label}' did not complete within ${timeoutMs}ms` }),
		}),
	);
};
